/**
 * Test Vehicle Command proxy and a sample command.
 * Usage: npm run test-command
 * Optional: npm run test-command -- honk_horn
 */

import vehicleCommandService from './vehicleCommandService.js';
import teslaService from './teslaService.js';
import { requireVehicleVin } from './vehicleUtils.js';

const command = (process.argv[2] || 'flash_lights') as Parameters<typeof vehicleCommandService.sendCommandWithFallback>[1];

async function main() {
    console.log('Checking Vehicle Command proxy...');
    const health = await vehicleCommandService.checkProxyHealth();
    console.log(health.ok ? `✓ ${health.message}` : `✗ ${health.message}`);
    if (!health.ok) {
        process.exit(1);
    }

    console.log('\nFetching vehicles...');
    const vehicles = await teslaService.getVehicles();
    if (vehicles.length === 0) {
        console.error('No vehicles found.');
        process.exit(1);
    }

    const vehicle = vehicles[0];
    const vin = requireVehicleVin(vehicle);
    console.log(`Using: ${vehicle.display_name} (VIN ${vin}, state ${vehicle.state})`);

    if (vehicle.state !== 'online') {
        console.log('Waking vehicle...');
        await teslaService.wakeUp(String(vehicle.id));
        await new Promise((r) => setTimeout(r, 5000));
    }

    console.log(`\nSending command: ${command}`);
    const { result, via } = await vehicleCommandService.sendCommandWithFallback(vin, command, {});
    console.log(`Success via ${via}:`, JSON.stringify(result, null, 2));
}

main().catch((err) => {
    console.error('Error:', err.message || err);
    process.exit(1);
});
