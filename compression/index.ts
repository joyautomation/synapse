import Long from "npm:long";
import { pipe } from "npm:ramda";
import { gzip, deflate, inflate, ungzip } from "npm:pako";
import { CompressPayloadInput, PayloadOptions } from "./types.d.ts";
import {
  type UPayload,
  type UMetric,
  encodePayload,
  decodePayload,
} from "npm:sparkplug-payload/lib/sparkplugbpayload.js";
import { log } from "../log.ts";
import { cond } from "../utils.ts";
import { Buffer } from "node:buffer";

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

const something: Long = Long.fromNumber(1);

something.toNumber();

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
    //@ts-ignore
    value: m.value instanceof Long ? m.value.toNumber() : m.value,
  })),
  timestamp:
    payload.timestamp instanceof Long
      ? //@ts-ignore
        payload.timestamp?.toNumber()
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
): any[] =>
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
 * Compresses the payload based on the provided options and compression algorithms.
 *
 * @param {PayloadOptions | undefined} options - The options for payload compression.
 * @param {UPayload} payload - The payload to be compressed.
 * @return {any} The compressed payload.
 */
export const compressPayload = (
  options: PayloadOptions | undefined,
  payload: UPayload
) =>
  cond<CompressPayloadInput, UPayload>({ options, payload }, [
    {
      condition: ({ options }: CompressPayloadInput) =>
        options == null || options.compress !== true,
      action: ({ options, payload }: CompressPayloadInput) => payload,
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
): any[] =>
  Object.keys(algorithms).map((algorithm) => ({
    condition: ({ metrics }: UPayload) =>
      metrics
        ?.find((m) => m.name === "algorithm")
        ?.value?.toString()
        .toUpperCase() === algorithm,
    action: ({ body }: UPayload) =>
      body != null
        ? pipe(
            algorithms[algorithm as keyof typeof algorithms].decompress,
            decodePayload,
            convertLongs
          )(body)
        : body,
  }));

/**
 * Decompresses the payload based on the provided decompression algorithms.
 *
 * @param {UPayload} payload - The payload to be decompressed.
 * @return {Uint8Array} The decompressed payload.
 */
export const decompressPayload = (payload: Buffer | UPayload): Uint8Array =>
  cond(payload, [
    {
      condition: ({ metrics }: UPayload) => !hasAlgorithm(metrics),
      action: (payload: UPayload) => payload,
    },
    ...generateDecompressionAlgorithmConditions(compressionAlgorithms),
    {
      condition: () => true,
      action: () => {
        throw new Error(`Unknown or unsupported algorithm`);
      },
    },
  ]);
