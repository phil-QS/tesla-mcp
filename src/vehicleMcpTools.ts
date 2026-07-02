import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import teslaService, { type Vehicle } from './teslaService.js';
import vehicleCommandService from './vehicleCommandService.js';
import { findVehicle, requireVehicleVin } from './vehicleUtils.js';

const VEHICLE_ID_SCHEMA = {
    vehicle_id: {
        type: 'string',
        description: 'Vehicle tag: id, vehicle_id, or VIN',
    },
} as const;

const DUMMY_PARAM_SCHEMA = {
    random_string: {
        type: 'string',
        description: 'Dummy parameter for no-parameter tools',
    },
} as const;

/** MCP tools always listed when at least one vehicle is connected. */
export const VEHICLE_MCP_TOOLS: Tool[] = [
    {
        name: 'wake_up',
        description: 'Wake up your Tesla vehicle from sleep mode',
        inputSchema: {
            type: 'object',
            properties: { ...VEHICLE_ID_SCHEMA },
            required: ['vehicle_id'],
        },
    },
    {
        name: 'refresh_vehicles',
        description: 'Refresh the list of Tesla vehicles',
        inputSchema: {
            type: 'object',
            properties: { ...DUMMY_PARAM_SCHEMA },
            required: ['random_string'],
        },
    },
    {
        name: 'debug_vehicles',
        description: 'Show debug information about available vehicles',
        inputSchema: {
            type: 'object',
            properties: { ...DUMMY_PARAM_SCHEMA },
            required: ['random_string'],
        },
    },
    {
        name: 'check_command_proxy',
        description: 'Check if the local Tesla Vehicle Command HTTP proxy is running (required for lock/climate/honk commands)',
        inputSchema: {
            type: 'object',
            properties: { ...DUMMY_PARAM_SCHEMA },
            required: ['random_string'],
        },
    },
    {
        name: 'get_vehicle_data',
        description: 'Get detailed vehicle data (battery, climate, charge state, etc.) via Vehicle Command proxy',
        inputSchema: {
            type: 'object',
            properties: { ...VEHICLE_ID_SCHEMA },
            required: ['vehicle_id'],
        },
    },
    {
        name: 'door_lock',
        description: 'Lock all doors. Requires Vehicle Command proxy and virtual key pairing.',
        inputSchema: {
            type: 'object',
            properties: { ...VEHICLE_ID_SCHEMA },
            required: ['vehicle_id'],
        },
    },
    {
        name: 'door_unlock',
        description: 'Unlock all doors. Requires Vehicle Command proxy and virtual key pairing.',
        inputSchema: {
            type: 'object',
            properties: { ...VEHICLE_ID_SCHEMA },
            required: ['vehicle_id'],
        },
    },
    {
        name: 'honk_horn',
        description: 'Honk the horn. Vehicle must be in park.',
        inputSchema: {
            type: 'object',
            properties: { ...VEHICLE_ID_SCHEMA },
            required: ['vehicle_id'],
        },
    },
    {
        name: 'flash_lights',
        description: 'Flash the exterior lights',
        inputSchema: {
            type: 'object',
            properties: { ...VEHICLE_ID_SCHEMA },
            required: ['vehicle_id'],
        },
    },
    {
        name: 'climate_on',
        description: 'Turn on climate control (auto conditioning start)',
        inputSchema: {
            type: 'object',
            properties: { ...VEHICLE_ID_SCHEMA },
            required: ['vehicle_id'],
        },
    },
    {
        name: 'climate_off',
        description: 'Turn off climate control (auto conditioning stop)',
        inputSchema: {
            type: 'object',
            properties: { ...VEHICLE_ID_SCHEMA },
            required: ['vehicle_id'],
        },
    },
    {
        name: 'set_climate_temp',
        description: 'Set driver and passenger cabin temperature in Celsius',
        inputSchema: {
            type: 'object',
            properties: {
                ...VEHICLE_ID_SCHEMA,
                driver_temp: {
                    type: 'number',
                    description: 'Driver temperature in Celsius (e.g. 22)',
                },
                passenger_temp: {
                    type: 'number',
                    description: 'Passenger temperature in Celsius (defaults to driver_temp)',
                },
            },
            required: ['vehicle_id', 'driver_temp'],
        },
    },
];

async function resolveVin(
    vehicles: Vehicle[],
    vehicleId: string
): Promise<{ vehicle: Vehicle; vin: string }> {
    const vehicle = findVehicle(vehicles, vehicleId);
    if (!vehicle) {
        throw new Error(`Vehicle ${vehicleId} not found`);
    }
    return { vehicle, vin: requireVehicleVin(vehicle) };
}

async function ensureAwakeIfNeeded(vehicle: Vehicle, vin: string): Promise<void> {
    if (vehicle.state === 'online') {
        return;
    }
    await teslaService.wakeUp(String(vehicle.id));
    await new Promise((r) => setTimeout(r, 3000));
}

function textResult(text: string) {
    return { content: [{ type: 'text' as const, text }] };
}

export async function handleVehicleMcpTool(
    name: string,
    args: Record<string, unknown> | undefined,
    getVehicles: (forceRefresh?: boolean) => Promise<Vehicle[]>,
    vehiclesCache: { length: number }
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    switch (name) {
        case 'wake_up': {
            const vehicleId = String(args?.vehicle_id ?? '');
            if (!vehicleId) throw new Error('vehicle_id is required');
            const vehicles = await getVehicles();
            const { vehicle } = await resolveVin(vehicles, vehicleId);
            const result = await teslaService.wakeUp(String(vehicle.id));
            return textResult(
                result
                    ? `Successfully woke up ${vehicle.display_name || 'your Tesla'} (state: ${result.state})`
                    : `Failed to wake up ${vehicle.display_name || 'your Tesla'}`
            );
        }

        case 'refresh_vehicles': {
            await getVehicles(true);
            return textResult(`Successfully refreshed the vehicle list. Found ${vehiclesCache.length} vehicles.`);
        }

        case 'debug_vehicles': {
            const vehicles = await getVehicles();
            if (vehicles.length === 0) {
                return textResult('No vehicles found. Check Tesla API credentials and vehicle authorization in Tesla App.');
            }
            const debugInfo = vehicles
                .map(
                    (v) =>
                        `Vehicle: ${v.display_name || 'Tesla'}\n` +
                        `- id: ${v.id}\n` +
                        `- vehicle_id: ${v.vehicle_id}\n` +
                        `- vin: ${v.vin}\n` +
                        `- state: ${v.state}`
                )
                .join('\n\n');
            return textResult(`Found ${vehicles.length} vehicles:\n\n${debugInfo}`);
        }

        case 'check_command_proxy': {
            const health = await vehicleCommandService.checkProxyHealth();
            return textResult(
                health.ok
                    ? `OK: ${health.message}`
                    : `NOT READY: ${health.message}`
            );
        }

        case 'get_vehicle_data': {
            const vehicleId = String(args?.vehicle_id ?? '');
            const vehicles = await getVehicles();
            const { vehicle, vin } = await resolveVin(vehicles, vehicleId);
            await ensureAwakeIfNeeded(vehicle, vin);
            const data = await vehicleCommandService.getVehicleData(vin);
            return textResult(JSON.stringify(data, null, 2));
        }

        case 'door_lock':
        case 'door_unlock':
        case 'honk_horn':
        case 'flash_lights':
        case 'climate_on':
        case 'climate_off': {
            const vehicleId = String(args?.vehicle_id ?? '');
            const vehicles = await getVehicles();
            const { vehicle, vin } = await resolveVin(vehicles, vehicleId);
            await ensureAwakeIfNeeded(vehicle, vin);

            const commandMap: Record<string, Parameters<typeof vehicleCommandService.sendCommandWithFallback>[1]> = {
                door_lock: 'door_lock',
                door_unlock: 'door_unlock',
                honk_horn: 'honk_horn',
                flash_lights: 'flash_lights',
                climate_on: 'auto_conditioning_start',
                climate_off: 'auto_conditioning_stop',
            };

            const command = commandMap[name];
            const { result, via } = await vehicleCommandService.sendCommandWithFallback(vin, command, {});
            return textResult(
                `Command ${name} sent to ${vehicle.display_name || vin} via ${via}.\nResponse: ${JSON.stringify(result)}`
            );
        }

        case 'set_climate_temp': {
            const vehicleId = String(args?.vehicle_id ?? '');
            const driverTemp = Number(args?.driver_temp);
            const passengerTemp = args?.passenger_temp != null ? Number(args.passenger_temp) : driverTemp;
            if (!Number.isFinite(driverTemp)) {
                throw new Error('driver_temp must be a number (Celsius)');
            }

            const vehicles = await getVehicles();
            const { vehicle, vin } = await resolveVin(vehicles, vehicleId);
            await ensureAwakeIfNeeded(vehicle, vin);

            const { result, via } = await vehicleCommandService.sendCommandWithFallback(vin, 'set_temps', {
                driver_temp: driverTemp,
                passenger_temp: passengerTemp,
            });
            return textResult(
                `Set climate to ${driverTemp}°C (passenger ${passengerTemp}°C) on ${vehicle.display_name || vin} via ${via}.\nResponse: ${JSON.stringify(result)}`
            );
        }

        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}
