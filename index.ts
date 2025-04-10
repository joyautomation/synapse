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
 * Flattens a SparkplugNode object into a simpler structure.
 *
 * This function converts the nested hierarchical structure of a SparkplugNode into a flat
 * representation where devices and metrics are stored in arrays. This is particularly useful
 * for serialization or when working with GraphQL schemas.
 *
 * @param {SparkplugNode} node - The SparkplugNode object to flatten
 * @returns {SparkplugNodeFlat} A flattened representation of the node with devices and metrics in arrays
 */
export { flattenNode } from "./stateMachines/host.ts";

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
export { disconnectHost } from "./stateMachines/host.ts";

/**
 * Flattens the groups of a host into a single array.
 * @function
 * @name flattenHostGroups
 * @memberof module:stateMachines
 */
export { flattenHostGroups } from "./stateMachines/host.ts";

/**
 * Exports logging-related functions.
 * @module log
 */

/**
 * Disables logging.
 * @function
 * @name disableLogv
 * @memberof module:log
 */

/**
 * Enables logging.
 * @function
 * @name enableLog
 * @memberof module:log
 */

/**
 * Logging utility object.
 * @const
 * @name logs
 * @memberof module:log
 */

/**
 * Sets the log level for the application.
 * @function
 * @name setLogLevel
 * @memberof module:log
 */
export { disableLog, enableLog, logs, setLogLevel } from "./log.ts";

export * from "./types.ts";

export * from "./mqtt.ts";

/**
 * Gets the current state of a Sparkplug node as a string.
 * @param {SparkplugNode} node - The Sparkplug node to get the state for.
 * @returns {string} The current state of the node as a string ("disconnected", "born", "dead", or "unknown state").
 */
export { getNodeStateString } from "./stateMachines/node.ts";

/**
 * Gets the current state of a SparkplugHost as a string.
 * @param {SparkplugHost} host - The SparkplugHost instance.
 * @returns {string} The current state as a string ("disconnected", "born", or "unknown state").
 */
export { getHostStateString } from "./stateMachines/host.ts";
