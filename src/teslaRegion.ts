import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';

export type TeslaRegion = 'NA' | 'EU' | 'CN';

export interface TeslaRegionConfig {
    region: TeslaRegion;
    fleetApiUrl: string;
    authBaseUrl: string;
    audience: string;
    developerPortal: string;
}

const REGION_CONFIGS: Record<TeslaRegion, Omit<TeslaRegionConfig, 'region'>> = {
    NA: {
        fleetApiUrl: 'https://fleet-api.prd.na.vn.cloud.tesla.com',
        authBaseUrl: 'https://auth.tesla.com/oauth2/v3',
        audience: 'https://fleet-api.prd.na.vn.cloud.tesla.com',
        developerPortal: 'https://developer.tesla.com'
    },
    EU: {
        fleetApiUrl: 'https://fleet-api.prd.eu.vn.cloud.tesla.com',
        authBaseUrl: 'https://auth.tesla.com/oauth2/v3',
        audience: 'https://fleet-api.prd.eu.vn.cloud.tesla.com',
        developerPortal: 'https://developer.tesla.com'
    },
    CN: {
        fleetApiUrl: 'https://fleet-api.prd.cn.vn.cloud.tesla.cn',
        authBaseUrl: 'https://auth.tesla.cn/oauth2/v3',
        audience: 'https://fleet-api.prd.cn.vn.cloud.tesla.cn',
        developerPortal: 'https://developer.tesla.cn'
    }
};

export function getTeslaRegion(): TeslaRegion {
    const raw = String(process.env.TESLA_REGION || 'NA').toUpperCase();
    if (raw === 'CN' || raw === 'EU' || raw === 'NA') return raw;
    return 'NA';
}

export function getTeslaRegionConfig(region: TeslaRegion = getTeslaRegion()): TeslaRegionConfig {
    return { region, ...REGION_CONFIGS[region] };
}

export function loadTeslaEnv(): string | null {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const candidates = [
        path.join(process.cwd(), '.env'),
        path.join(moduleDir, '../.env'),
        path.join(moduleDir, '../../.env'),
    ];
    for (const envPath of candidates) {
        if (fs.existsSync(envPath)) {
            dotenv.config({ path: envPath });
            return envPath;
        }
    }
    return null;
}
