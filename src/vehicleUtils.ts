import type { Vehicle } from './teslaService.js';

export function findVehicle(vehicles: Vehicle[], vehicleId: string): Vehicle | undefined {
    return vehicles.find(v =>
        String(v.id) === vehicleId ||
        String(v.vehicle_id) === vehicleId ||
        String(v.vin).toUpperCase() === vehicleId.toUpperCase()
    );
}

export function requireVehicleVin(vehicle: Vehicle): string {
    const vin = vehicle.vin?.trim();
    if (!vin) {
        throw new Error('Vehicle has no VIN; Vehicle Command API requires VIN');
    }
    return vin;
}
