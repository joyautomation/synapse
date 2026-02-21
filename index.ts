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

/**
 * Returns the template definitions registry for a host.
 * Populated from NBIRTH metrics with isDefinition=true.
 * @param {SparkplugHost} host - The SparkplugHost instance.
 * @returns {Map<string, UTemplate>} Map of template name to definition.
 */
export { getTemplateDefinitions } from "./stateMachines/host.ts";

/**
 * Flattens template instance metrics into individual scalar metrics with path-based names.
 * Template definitions (isDefinition=true) are skipped.
 * @param {UMetric[]} metrics - The metrics array to flatten.
 * @param {string} [parentPath] - Path prefix for nested templates.
 * @param {string} [parentTemplateRef] - Template definition name.
 * @param {string} [parentInstance] - Template instance name.
 * @returns {UMetric[]} Flattened metrics with templateRef and templateInstance annotations.
 */
export { flattenTemplateMetrics } from "./stateMachines/host.ts";

/**
 * Extracts template definitions from metrics and stores them in the host registry.
 * @param {SparkplugHost} host - The SparkplugHost instance.
 * @param {UMetric[]} metrics - The metrics to scan for definitions.
 */
export { extractAndStoreDefinitions } from "./stateMachines/host.ts";

/**
 * Adds metrics to a Sparkplug node or device, merging with existing metrics.
 * @param {SparkplugNode} node - The Sparkplug node to modify.
 * @param {Record<string, SparkplugMetric>} metrics - Record of metrics to add (will be merged with existing metrics).
 * @param {string} [deviceId] - Optional device ID. If provided, adds metrics to the device; otherwise adds to the node.
 * @returns {Result<SparkplugNode>} Success result with the updated node, or failure if the device doesn't exist.
 */
export { addMetrics } from "./stateMachines/node.ts";

/**
 * Sets metrics on a Sparkplug node or device, replacing all existing metrics.
 * @param {SparkplugNode} node - The Sparkplug node to modify.
 * @param {Record<string, SparkplugMetric>} metrics - Record of metrics to set (will replace all existing metrics).
 * @param {string} [deviceId] - Optional device ID. If provided, sets metrics on the device; otherwise sets on the node.
 * @returns {Result<SparkplugNode>} Success result with the updated node, or failure if the device doesn't exist.
 */
export { setMetrics } from "./stateMachines/node.ts";

/**
 * Removes specified metrics from a Sparkplug node or device by name.
 * @param {SparkplugNode} node - The Sparkplug node to modify.
 * @param {string[]} names - Array of metric names to remove.
 * @param {string} [deviceId] - Optional device ID. If provided, removes metrics from the device; otherwise removes from the node.
 * @returns {Result<SparkplugNode>} Success result with the updated node, or failure if the device doesn't exist.
 */
export { removeMetrics } from "./stateMachines/node.ts";

/**
 * Updates the value of a specific metric on a Sparkplug node or device.
 * @param {SparkplugNode} node - The Sparkplug node to modify.
 * @param {string} name - The name of the metric to update.
 * @param {SparkplugMetric["value"]} value - The new value to set for the metric.
 * @param {string} [deviceId] - Optional device ID. If provided, updates the metric on the device; otherwise updates on the node.
 * @returns {Result<SparkplugNode>} Success result with the updated node, or failure if the device doesn't exist.
 */
export { setValue } from "./stateMachines/node.ts";

