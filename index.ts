/**
 * @module stateMachines
 */

/**
 * Creates a new node.
 * @function
 * @name createNode
 * @memberof module:stateMachines
 */
export { createNode } from "./stateMachines/node.ts";

/**
 * Disconnects a node.
 * @function
 * @name disconnectNode
 * @memberof module:stateMachines
 */
export { disconnectNode } from "./stateMachines/node.ts";

/**
 * Creates a new host.
 * @function
 * @name createHost
 * @memberof module:stateMachines
 */
export { createHost } from "./stateMachines/host.ts";

/**
 * Disconnects a host.
 * @function
 * @name disconnectHost
 * @memberof module:stateMachines
 */
/**
 * Disconnects a host.
 * @function
 * @name disconnectHost
 * @memberof module:stateMachines
 */
export { disconnectHost } from "./stateMachines/host.ts";

/**
 * Flattens the groups of a host into a single array.
 * @function
 * @name flattenHostGroups
 * @memberof module:stateMachines
 */
export { flattenHostGroups } from "./stateMachines/host.ts";

/**
 * Sets the log level for the application.
 * @function
 * @name setLogLevel
 * @memberof module:log
 */
export { setLogLevel } from "./log.ts";

export type * from "./types.d.ts";
