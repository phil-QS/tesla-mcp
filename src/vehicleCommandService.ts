/**
 * Tesla Vehicle Command client via official tesla-http-proxy (Vehicle Command Protocol).
 * @see https://github.com/teslamotors/vehicle-command
 */

import axios, { type AxiosInstance } from 'axios';
import { execSync } from 'child_process';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import teslaService from './teslaService.js';
import { getTeslaRegionConfig } from './teslaRegion.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');

export type VehicleCommandName =
    | 'door_lock'
    | 'door_unlock'
    | 'honk_horn'
    | 'flash_lights'
    | 'auto_conditioning_start'
    | 'auto_conditioning_stop'
    | 'set_temps'
    | 'actuate_trunk'
    | 'charge_port_door_open'
    | 'charge_port_door_close';

function getWslHostIp(): string | null {
    if (process.platform !== 'win32') {
        return null;
    }
    try {
        const output = execSync('wsl hostname -I', { encoding: 'utf8', timeout: 8000 }).trim();
        const ip = output.split(/\s+/).find((part) => /^\d+\.\d+\.\d+\.\d+$/.test(part));
        return ip || null;
    } catch {
        return null;
    }
}

function resolveProxyBaseUrl(): string {
    const configured = process.env.TESLA_COMMAND_PROXY_URL?.trim();
    if (configured) {
        return configured.replace(/\/$/, '');
    }

    // WSL proxy often not reachable via 127.0.0.1 on Windows; use WSL eth0 IP.
    const wslIp = getWslHostIp();
    if (wslIp) {
        return `https://${wslIp}:4443`;
    }

    return 'https://127.0.0.1:4443';
}

function resolveProxyCaPath(): string | null {
    const configured = process.env.TESLA_COMMAND_PROXY_CA?.trim();
    const candidates = [
        configured,
        path.join(PROJECT_ROOT, 'config', 'tls-cert.pem'),
        path.join(process.cwd(), 'config', 'tls-cert.pem'),
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

function createProxyClient(): AxiosInstance {
    const caPath = resolveProxyCaPath();
    const httpsAgent = caPath
        ? new https.Agent({
            ca: fs.readFileSync(caPath),
            servername: 'localhost',
        })
        : new https.Agent({ rejectUnauthorized: false, servername: 'localhost' });

    if (!caPath) {
        console.error('[vehicle-command] Warning: TLS CA not found (config/tls-cert.pem). Using insecure TLS for local proxy.');
    }

    return axios.create({
        baseURL: resolveProxyBaseUrl(),
        httpsAgent,
        timeout: 120_000,
        validateStatus: () => true,
    });
}

function formatApiError(status: number, data: unknown): string {
    const body = typeof data === 'string' ? data : JSON.stringify(data);
    return `HTTP ${status}: ${body}`;
}

export class VehicleCommandService {
    private client = createProxyClient();

    getProxyBaseUrl(): string {
        return resolveProxyBaseUrl();
    }

    async checkProxyHealth(): Promise<{ ok: boolean; message: string }> {
        try {
            for (const path of ['/health', '/']) {
                const response = await this.client.get(path);
                if (response.status >= 200 && response.status < 500) {
                    return { ok: true, message: `Proxy reachable at ${this.getProxyBaseUrl()}` };
                }
            }
            return { ok: false, message: `Proxy returned unexpected status` };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                ok: false,
                message: `Cannot reach Vehicle Command proxy at ${this.getProxyBaseUrl()}: ${message}. Run: npm run command-proxy`,
            };
        }
    }

    /**
     * GET vehicle_data via proxy (unsigned endpoints are forwarded to Fleet API).
     */
    async getVehicleData(vin: string): Promise<Record<string, unknown>> {
        const token = await teslaService.fetchAccessToken();
        const response = await this.client.get(`/api/1/vehicles/${vin}/vehicle_data`, {
            headers: { Authorization: `Bearer ${token}` },
        });

        if (response.status >= 400) {
            throw new Error(formatApiError(response.status, response.data));
        }
        return response.data?.response ?? response.data;
    }

    /**
     * Send a signed vehicle command through tesla-http-proxy.
     * Commands use VIN in the URL path.
     */
    async sendCommand(
        vin: string,
        command: VehicleCommandName,
        body: Record<string, unknown> = {}
    ): Promise<unknown> {
        const token = await teslaService.fetchAccessToken();
        const response = await this.client.post(
            `/api/1/vehicles/${vin}/command/${command}`,
            body,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        if (response.status >= 400) {
            const hint = response.status === 0 || response.status === 502
                ? ' Is tesla-http-proxy running? (npm run command-proxy)'
                : '';
            throw new Error(formatApiError(response.status, response.data) + hint);
        }

        return response.data?.response ?? response.data;
    }

    /**
     * Fallback: direct Fleet API command (pre-2021 S/X or legacy; usually fails on newer cars).
     */
    async sendCommandDirect(
        vin: string,
        command: VehicleCommandName,
        body: Record<string, unknown> = {}
    ): Promise<unknown> {
        const token = await teslaService.fetchAccessToken();
        const region = getTeslaRegionConfig();
        const url = `${region.fleetApiUrl}/api/1/vehicles/${vin}/command/${command}`;
        const response = await axios.post(url, body, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            validateStatus: () => true,
        });

        if (response.status >= 400) {
            throw new Error(formatApiError(response.status, response.data));
        }
        return response.data?.response ?? response.data;
    }

    async sendCommandWithFallback(
        vin: string,
        command: VehicleCommandName,
        body: Record<string, unknown> = {}
    ): Promise<{ result: unknown; via: 'proxy' | 'direct' }> {
        const mode = (process.env.TESLA_COMMAND_MODE || 'proxy').toLowerCase();

        if (mode === 'direct') {
            return { result: await this.sendCommandDirect(vin, command, body), via: 'direct' };
        }

        try {
            return { result: await this.sendCommand(vin, command, body), via: 'proxy' };
        } catch (proxyError) {
            if (mode === 'proxy-only') {
                throw proxyError;
            }
            const msg = proxyError instanceof Error ? proxyError.message : String(proxyError);
            if (msg.includes('public key has not been paired') || msg.includes('virtual key')) {
                throw new Error(
                    'Vehicle Command proxy is running, but the virtual key is not paired on this car. ' +
                    'Open Tesla App → Security → Third-party apps → authorize your app and complete virtual key pairing. ' +
                    `Details: ${msg}`
                );
            }
            console.error('[vehicle-command] Proxy failed, trying direct Fleet API:', proxyError);
            return { result: await this.sendCommandDirect(vin, command, body), via: 'direct' };
        }
    }
}

const vehicleCommandService = new VehicleCommandService();
export default vehicleCommandService;
