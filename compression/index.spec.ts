import { describe, it } from "jsr:@std/testing/bdd";
import { expect } from "jsr:@std/expect";
import { compressPayload, decompressPayload, hasAlgorithm } from "./index.ts";
import {
  UPayload,
  encodePayload,
} from "npm:sparkplug-payload/lib/sparkplugbpayload.js";
import { gzip, deflate } from "npm:pako";

describe("hasAlgorithm", () => {
  it("returns true if there is a metric with the name algorithm", () => {
    const payload: UPayload = {
      timestamp: new Date().getTime(),
      metrics: [
        {
          name: "algorithm",
          type: "String",
          value: "GZIP",
        },
      ],
    };
    expect(hasAlgorithm(payload.metrics)).toBe(true);
  });
  it("returns false if there is no metric with the name algorithm", () => {
    const payload: UPayload = {
      timestamp: new Date().getTime(),
      metrics: [],
    };
    expect(hasAlgorithm(payload.metrics)).toBe(false);
    payload.metrics = [
      {
        name: "aMetric",
        type: "UInt64",
        value: 12345,
      },
    ];
    expect(hasAlgorithm(payload.metrics)).toBe(false);
  });
  it("returns false if metrics is null or undefined", () => {
    expect(hasAlgorithm(null)).toBe(false);
    expect(hasAlgorithm(undefined)).toBe(false);
  });
});

describe("compressPayload", () => {
  const payload: UPayload = {
    timestamp: new Date().getTime(),
    metrics: [
      {
        name: "aMetric",
        value: 12345,
        type: "UInt64",
      },
    ],
  };
  const encodedPayload = encodePayload(payload);
  const uncompressedPayload = {
    body: encodePayload(payload),
  };
  const gzippedPayload = {
    metrics: [
      {
        name: "algorithm",
        type: "String",
        value: "GZIP",
      },
    ],
    body: gzip(encodedPayload),
  };
  const deflatedPayload = {
    metrics: [
      {
        name: "algorithm",
        type: "String",
        value: "DEFLATE",
      },
    ],
    body: deflate(encodedPayload),
  };
  it("returns uncompressed payload if there are no options or compression defined", () => {
    expect(compressPayload(undefined, payload)).toEqual(payload);
    expect(compressPayload({}, payload)).toEqual(payload);
  });
  it("returns uncompressed payload if compress is false", () => {
    expect(compressPayload({ compress: false }, payload)).toEqual(payload);
  });
  it("returns uncompressed payload and logs a message if compression algorithm is undefined", () => {
    expect(compressPayload({ compress: true }, payload)).toEqual(payload);
    expect(console.error).toBeCalledTimes(1);
  });
  it("returns uncompressed payload and logs a message if compression algorithm is not supported.", () => {
    const badAlgorithm = "BadAlgorithm" as "GZIP";
    expect(
      compressPayload({ compress: true, algorithm: badAlgorithm }, payload)
    ).toEqual(payload);
    expect(console.error).toBeCalledTimes(1);
  });
  it("GZIPs", () => {
    expect(
      compressPayload({ compress: true, algorithm: "GZIP" }, payload)
    ).toEqual(gzippedPayload);
  });
  it("DEFLATEs", () => {
    expect(
      compressPayload({ compress: true, algorithm: "DEFLATE" }, payload)
    ).toEqual(deflatedPayload);
  });
});

describe("decompressPayload", () => {
  const payload: UPayload = {
    timestamp: new Date().getTime(),
    metrics: [
      {
        name: "aMetric",
        value: 12345,
        type: "UInt64",
      },
    ],
  };
  const encodedPayload = encodePayload(payload);
  const gzippedPayload: UPayload = {
    metrics: [
      {
        name: "algorithm",
        type: "String",
        value: "GZIP",
      },
    ],
    body: gzip(encodedPayload),
  };
  const deflatedPayload: UPayload = {
    metrics: [
      {
        name: "algorithm",
        type: "String",
        value: "DEFLATE",
      },
    ],
    body: deflate(encodedPayload),
  };
  it("UNGZIPs", () => {
    expect(decompressPayload(gzippedPayload)).toEqual(payload);
  });
  it("INFLATEs", () => {
    expect(decompressPayload(deflatedPayload)).toEqual(payload);
  });
});
