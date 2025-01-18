import Long from "long";
import { pipe } from "@joyautomation/dark-matter";
import { deflate, gzip, inflate, ungzip } from "pako";
import type { CompressPayloadInput, PayloadOptions } from "./types.ts";
import {
  decodePayload,
  encodePayload,
  type UMetric,
  type UPayload,
} from "sparkplug-payload/lib/sparkplugbpayload.js";
import { logs } from "../log.ts";
const { main: log } = logs;
import { cond } from "@joyautomation/dark-matter";
import { isBuffer } from "../utils.ts";

export const compressed = "SPBV1.0_COMPRESSED";

const compressionAlgorithms = {
  GZIP: {
    compress: gzip,
    decompress: ungzip,
  },
  DEFLATE: {
    compress: deflate,
    decompress: inflate,
  },
};

/**
 * Updates the payload by converting any Long values in the metrics and the timestamp to numbers.
 *
 * @param {UPayload} payload - The payload object to convert Long values.
 * @return {UPayload} The updated payload with Long values converted to numbers.
 */
const convertLongs = (payload: UPayload) => ({
  ...payload,
  metrics: payload.metrics?.map((m: UMetric) => ({
    ...m,
    value: m.value instanceof Long ? m.value.toNumber() : m.value,
  })),
  timestamp:
    payload.timestamp instanceof Long
      ? payload.timestamp?.toNumber()
      : payload.timestamp,
});

/**
 * Generates an array of conditions and actions based on the compression algorithms provided.
 *
 * @param {typeof compressionAlgorithms} algorithms - The compression algorithms to generate conditions for.
 * @return {any[]} Array of objects containing condition and action functions.
 */
const generateCompressionAlgorithmConditions = (
  algorithms: typeof compressionAlgorithms
) =>
  Object.keys(algorithms).map((algorithm) => ({
    condition: ({ options }: CompressPayloadInput) =>
      options != null && options.algorithm === algorithm,
    action: ({ options, payload }: CompressPayloadInput) =>
      ({
        body: algorithms[algorithm as keyof typeof algorithms].compress(
          encodePayload(payload)
        ),
        metrics: [
          {
            name: "algorithm",
            value: options?.algorithm?.toUpperCase(),
            type: "String",
          },
        ],
      } as UPayload),
  }));

/**
 * Compresses the payload using the specified algorithm.
 * @param {PayloadOptions | undefined} options - Compression options.
 * @param {UPayload} payload - The payload to compress.
 * @returns {UPayload} The compressed payload.
 */
export const compressPayload = (
  options: PayloadOptions | undefined,
  payload: UPayload
) =>
  cond<CompressPayloadInput, UPayload>({ options, payload }, [
    {
      condition: ({ options }: CompressPayloadInput) =>
        options == null || options.compress !== true,
      action: ({ payload }: CompressPayloadInput) => payload,
    },
    ...generateCompressionAlgorithmConditions(compressionAlgorithms),
    {
      condition: () => true,
      action: ({ options, payload }: CompressPayloadInput) => {
        log.error(`Unknown or unsupported algorithm ${options?.algorithm}`);
        return payload;
      },
    },
  ]);

/**
 * Curried version of compressPayload.
 * @param {PayloadOptions | undefined} options - Compression options.
 * @returns {function(UPayload): UPayload} A function that takes a payload and returns the compressed payload.
 */
export const compressPayloadCurry =
  (options: PayloadOptions | undefined) => (payload: UPayload) =>
    compressPayload(options, payload);

/**
 * Checks if the given metrics contain an 'algorithm' name.
 *
 * @param {UMetric[] | null | undefined} metrics - The metrics to check.
 * @return {boolean} true if 'algorithm' name is found, false otherwise.
 */
export const hasAlgorithm = (metrics: UMetric[] | null | undefined) =>
  metrics != null && metrics.find((m) => m.name === "algorithm") != null;

/**
 * Generates an array of conditions and actions based on the decompression algorithms provided.
 *
 * @param {typeof compressionAlgorithms} algorithms - The decompression algorithms to generate conditions for.
 * @return {any[]} Array of objects containing condition and action functions.
 */
const generateDecompressionAlgorithmConditions = (
  algorithms: typeof compressionAlgorithms
) =>
  Object.keys(algorithms).map((algorithm) => ({
    condition: (payload?: UPayload | Uint8Array) => {
      return (
        isBuffer(payload) ||
        payload?.metrics
          ?.find((m) => m.name === "algorithm")
          ?.value?.toString()
          .toUpperCase() === algorithm
      );
    },

    action: (payload?: UPayload | Uint8Array) => {
      if (!isBuffer(payload)) {
        return payload?.body != null
          ? pipe(
              payload.body,
              algorithms[algorithm as keyof typeof algorithms].decompress,
              decodePayload,
              convertLongs
            )
          : payload?.body;
      } else {
        return payload;
      }
    },
  }));

/**
 * Decompresses the payload based on the provided decompression algorithms.
 * @param {Buffer | UPayload} payload - The payload to be decompressed.
 * @returns {Uint8Array} The decompressed payload.
 * @throws {Error} If an unknown or unsupported algorithm is encountered.
 */
export const decompressPayload = (payload?: UPayload | Uint8Array) =>
  cond(payload, [
    {
      condition: (payload): boolean =>
        isBuffer(payload) || !hasAlgorithm(payload?.metrics),
      action: (payload) => payload,
    },
    ...generateDecompressionAlgorithmConditions(compressionAlgorithms),
    {
      condition: () => true,
      action: () => {
        throw new Error(`Unknown or unsupported algorithm`);
      },
    },
  ]);
