/**
 * Finds the first conditional that matches the condition based on the args provided and executes its action.
 *
 * @param {T} args - The argument to be checked against the conditionals.
 * @param {{ condition: (input: T) => boolean; action: (input: T) => UPayload }[]} conditionals - Array of objects containing condition and action functions.
 * @return {UPayload | undefined} The result of executing the action function of the matched conditional.
 */
export const cond = <T, U>(
  args: T,
  conditionals: {
    condition: (input: T) => boolean;
    action: (input: T) => U;
  }[]
) => {
  const conditional = conditionals.find(
    (conditional: {
      condition: (input: T) => boolean;
      action: (input: T) => U;
    }) => {
      return conditional.condition(args);
    }
  );
  if (!conditional) throw new Error("No conditional found");
  return conditional.action(args);
};

/**
 * Checks if any of the provided boolean values are true.
 *
 * @param {...boolean} values - A list of boolean values to check.
 * @returns {boolean} True if at least one value is true, false otherwise.
 */
export const someTrue = (...values: boolean[]): boolean =>
  values.some((value) => value === true);

/**
 * Updates the state of an entity by merging the provided state with the existing state.
 *
 * @param {Partial<T>} state - The partial state to be merged with the existing state.
 * @param {Object} entity - The entity whose state is to be updated.
 * @returns {Object} The updated entity with the new state.
 * @template T
 */
export const setState = <U extends { states: T }, T>(
  state: Partial<T>,
  entity: U
): U => {
  entity.states = { ...entity.states, ...state };
  return entity;
};

/**
 * Creates a curried version of the setState function.
 *
 * @template U - The type of the entity object.
 * @template T - The type of the entity's state.
 * @param {Partial<T>} state - The partial state to be merged with the existing state.
 * @returns {(entity: U) => U} A function that takes an entity and returns the updated entity.
 */
export const setStateCurry =
  <U extends { states: T }, T>(state: Partial<T>) =>
  (entity: U): U =>
    setState(state, entity);

/**
 * To be used to log values to the console within a pipe.
 *
 * @param {...unknown[]} args - The arguments to be logged.
 * @returns {void}
 */
export const taplog = (...args: unknown[]): void => console.log(...args);
