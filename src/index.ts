#!/usr/bin/env node

/**
 * Tesla MCP Server
 * A Model Context Protocol server that connects to the Tesla Fleet API
 * and allows controlling Tesla vehicles through AI assistants.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import teslaService, { Vehicle } from "./teslaService.js";
import { VEHICLE_MCP_TOOLS, handleVehicleMcpTool } from "./vehicleMcpTools.js";
import vehicleCommandService from "./vehicleCommandService.js";

/**
 * Cache for Tesla vehicles to avoid repeated API calls
 */
let vehiclesCache: Vehicle[] = [];
let lastVehicleFetch: number = 0;
const CACHE_TTL = 60000; // 1 minute

/**
 * Check if vehicles cache needs refreshing and update if necessary
 */
async function getVehicles(forceRefresh = false): Promise<Vehicle[]> {
  const now = Date.now();

  if (forceRefresh || vehiclesCache.length === 0 || (now - lastVehicleFetch) > CACHE_TTL) {
    try {
      vehiclesCache = await teslaService.getVehicles();
      lastVehicleFetch = now;
    } catch (error) {
      console.error("Error fetching vehicles:", error);
      // Return empty array if error, but don't update last fetch time
      if (vehiclesCache.length === 0) {
        return [];
      }
    }
  }

  return vehiclesCache;
}

/**
 * Create an MCP server with capabilities for resources (to list/view vehicles),
 * tools (to control vehicles), and prompts.
 */
const server = new Server(
  {
    name: "tesla-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
      prompts: {},
    },
  }
);

/**
 * Handler for listing available vehicles as resources.
 * Each vehicle is exposed as a resource with:
 * - A tesla:// URI scheme
 * - JSON MIME type
 * - Vehicle display name and VIN
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const vehicles = await getVehicles();

  return {
    resources: vehicles.map((vehicle) => ({
      uri: `tesla://${vehicle.id}`,
      mimeType: "application/json",
      name: vehicle.display_name || `Tesla (${vehicle.vin})`,
      description: `Tesla vehicle: ${vehicle.display_name || 'Unknown'} (VIN: ${vehicle.vin})`
    }))
  };
});

/**
 * Handler for reading the details of a specific vehicle.
 * Takes a tesla:// URI and returns the vehicle data as JSON.
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const url = new URL(request.params.uri);
  const vehicleId = url.hostname;
  const vehicles = await getVehicles();

  const vehicle = vehicles.find(v => v.id === vehicleId);

  if (!vehicle) {
    throw new Error(`Vehicle ${vehicleId} not found`);
  }

  return {
    contents: [{
      uri: request.params.uri,
      mimeType: "application/json",
      text: JSON.stringify(vehicle, null, 2)
    }]
  };
});

/**
 * Handler that lists available tools.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const vehicles = await getVehicles();

  if (vehicles.length === 0) {
    return {
      tools: VEHICLE_MCP_TOOLS.filter((t) =>
        ['refresh_vehicles', 'debug_vehicles', 'check_command_proxy'].includes(t.name)
      ),
    };
  }

  return { tools: VEHICLE_MCP_TOOLS };
});

/**
 * Handler for the vehicle control tools.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  return handleVehicleMcpTool(
    request.params.name,
    request.params.arguments as Record<string, unknown> | undefined,
    getVehicles,
    vehiclesCache
  );
});

/**
 * Handler that lists available prompts.
 * Exposes a prompt to get information about all Tesla vehicles.
 */
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: "summarize_vehicles",
        description: "Get information about your Tesla vehicles",
      }
    ]
  };
});

/**
 * Handler for the summarize_vehicles prompt.
 * Returns a prompt that includes all vehicle information embedded as resources.
 */
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (request.params.name !== "summarize_vehicles") {
    throw new Error("Unknown prompt");
  }

  const vehicles = await getVehicles();

  if (vehicles.length === 0) {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "I don't have any Tesla vehicles connected. Please make sure you've set up your Tesla API credentials correctly in the .env file."
          }
        }
      ]
    };
  }

  const embeddedVehicles = vehicles.map(vehicle => ({
    type: "resource" as const,
    resource: {
      uri: `tesla://${vehicle.id}`,
      mimeType: "application/json",
      text: JSON.stringify(vehicle, null, 2)
    }
  }));

  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "Here is the information about my Tesla vehicles:"
        }
      },
      ...embeddedVehicles.map(vehicle => ({
        role: "user" as const,
        content: vehicle
      })),
      {
        role: "user",
        content: {
          type: "text",
          text: "Please provide a summary of all my Tesla vehicles including their names, battery levels, and current state (online/offline/asleep)."
        }
      }
    ]
  };
});

/**
 * Start the server using stdio transport.
 * This allows the server to communicate via standard input/output streams.
 */
async function main() {
  try {
    await getVehicles();
    const proxyHealth = await vehicleCommandService.checkProxyHealth();
    if (!proxyHealth.ok) {
      console.error(`[vehicle-command] ${proxyHealth.message}`);
    } else {
      console.error(`[vehicle-command] ${proxyHealth.message}`);
    }
  } catch (error) {
    // Use stderr instead of stdout for error messages
    console.error("Warning: Failed to connect to Tesla API on startup. Please check your credentials.");
    // Don't include the full error as it might contain sensitive information
    // console.error(error);
    // Continue anyway, since credentials might be updated later
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  // Log to stderr, not stdout
  console.error("Server error:", error);
  process.exit(1);
});
