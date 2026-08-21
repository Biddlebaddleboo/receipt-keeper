import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildJpegConversionArguments,
  convertImageBlobToJpeg,
  convertReceiptImageFile,
  JPEG_DOWNLOAD_QUALITY,
  normalizeErrorMessage,
} from "@/lib/ffmpegImageConverter";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  writeFile: vi.fn(),
  exec: vi.fn(),
  readFile: vi.fn(),
  deleteFile: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  fetchFile: vi.fn(),
}));

vi.mock("@ffmpeg/ffmpeg", () => ({
  FFmpeg: class MockFFmpeg {
    loaded = false;
    load = mocks.load;
    writeFile = mocks.writeFile;
    exec = mocks.exec;
    readFile = mocks.readFile;
    deleteFile = mocks.deleteFile;
    on = mocks.on;
    off = mocks.off;
  },
}));

vi.mock("@ffmpeg/util", () => ({ fetchFile: mocks.fetchFile }));

describe("download JPEG conversion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.load.mockResolvedValue(undefined);
    mocks.exec.mockResolvedValue(0);
    mocks.fetchFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.readFile.mockResolvedValue(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    mocks.deleteFile.mockResolvedValue(undefined);
    mocks.on.mockImplementation(() => undefined);
    mocks.off.mockImplementation(() => undefined);
  });

  it("uses the exact pre-resize JPEG command", () => {
    const args = buildJpegConversionArguments("input.webp", "output.jpg");

    expect(args).toEqual([
      "-i",
      "input.webp",
      "-frames:v",
      "1",
      "-c:v",
      "mjpeg",
      "-q:v",
      "2",
      "-y",
      "output.jpg",
    ]);
  });

  it("encodes downloaded JPEGs with MJPEG quality 2", async () => {
    const output = await convertImageBlobToJpeg(new Blob(["webp"], { type: "image/webp" }));

    expect(JPEG_DOWNLOAD_QUALITY).toBe(2);
    expect(output.type).toBe("image/jpeg");
    const args = mocks.exec.mock.calls[0]?.[0] as string[];
    expect(args).toEqual(expect.arrayContaining([
      "-frames:v",
      "1",
      "-c:v",
      "mjpeg",
      "-q:v",
      "2",
    ]));
    expect(args).not.toContain("-vf");
    expect(args).not.toContain("-f");
    expect(args).not.toContain("-update");
    expect(args.some((argument) => argument.includes("scale="))).toBe(false);
    expect(mocks.deleteFile).toHaveBeenCalledTimes(2);
    expect(mocks.on).toHaveBeenCalledTimes(1);
    expect(mocks.off).toHaveBeenCalledTimes(1);
  });

  it("treats an FFmpeg exit code of zero as success", async () => {
    mocks.exec.mockResolvedValue(0);

    await expect(convertImageBlobToJpeg(new Blob(["webp"], { type: "image/webp" }))).resolves.toMatchObject({
      type: "image/jpeg",
    });
    expect(mocks.readFile).toHaveBeenCalledTimes(1);
  });

  it("keeps WebP upload conversion separate from JPEG download settings", async () => {
    const output = await convertReceiptImageFile(new File(["image"], "receipt.jpg", { type: "image/jpeg" }));

    expect(output.type).toBe("image/webp");
    expect(output.name).toBe("receipt.webp");
    expect(mocks.exec).toHaveBeenCalledWith(expect.arrayContaining([
      "-c:v",
      "libwebp",
      "-q:v",
      "85",
      "-compression_level",
      "10",
      "-preset",
      "picture",
      "-y",
    ]));
  });

  it("reports a non-zero FFmpeg exit code without reading a missing output", async () => {
    mocks.exec.mockResolvedValue(7);

    await expect(convertImageBlobToJpeg(new Blob(["webp"], { type: "image/webp" })))
      .rejects.toThrow(/FFmpeg exited with code 7/);
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.deleteFile).toHaveBeenCalledTimes(2);
    expect(mocks.off).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["worker failed", "worker failed"],
    [42, "42"],
    [new DOMException("conversion aborted", "AbortError"), "AbortError: conversion aborted"],
  ])("preserves non-Error FFmpeg failures (%s)", async (rejection, expected) => {
    mocks.exec.mockRejectedValue(rejection);

    await expect(convertImageBlobToJpeg(new Blob(["webp"], { type: "image/webp" })))
      .rejects.toThrow(expected);
    expect(mocks.deleteFile).toHaveBeenCalledTimes(2);
  });

  it("includes the latest relevant FFmpeg log and removes the listener", async () => {
    mocks.exec.mockResolvedValue(1);
    mocks.on.mockImplementation((_event, callback) => {
      callback({ type: "stdout", message: "frame=1" });
      callback({ type: "fferr", message: "Invalid data found when processing input" });
    });

    await expect(convertImageBlobToJpeg(new Blob(["webp"], { type: "image/webp" })))
      .rejects.toThrow(/FFmpeg log: fferr: Invalid data found when processing input/);
    expect(mocks.off).toHaveBeenCalledTimes(1);
  });

  it("does not accumulate log listeners across conversions", async () => {
    await convertImageBlobToJpeg(new Blob(["webp"], { type: "image/webp" }));
    await convertImageBlobToJpeg(new Blob(["webp"], { type: "image/webp" }));

    expect(mocks.on).toHaveBeenCalledTimes(2);
    expect(mocks.off).toHaveBeenCalledTimes(2);
  });

  it("normalizes arbitrary thrown values with useful messages", () => {
    expect(normalizeErrorMessage("worker failed")).toBe("worker failed");
    expect(normalizeErrorMessage(12)).toBe("12");
    expect(normalizeErrorMessage({ reason: "bad input" })).toBe('{"reason":"bad input"}');
  });
});
