import { beforeEach, describe, expect, it, vi } from "vitest";
import { convertReceiptImageFile } from "@/lib/ffmpegImageConverter";
import { normalizeErrorMessage } from "@/lib/imageErrors";

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

const uploadFile = () => new File(["image"], "receipt.jpg", { type: "image/jpeg" });

describe("upload WebP conversion", () => {
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

  it("keeps the existing WebP upload conversion unchanged", async () => {
    const output = await convertReceiptImageFile(uploadFile());

    expect(output.type).toBe("image/webp");
    expect(output.name).toBe("receipt.webp");
    expect(mocks.exec).toHaveBeenCalledWith(expect.arrayContaining([
      "-vf",
      "scale='if(gt(iw,2000),2000,iw)':-2",
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
    expect(mocks.deleteFile).toHaveBeenCalledTimes(2);
    expect(mocks.on).toHaveBeenCalledTimes(1);
    expect(mocks.off).toHaveBeenCalledTimes(1);
  });

  it("treats an FFmpeg exit code of zero as success", async () => {
    await expect(convertReceiptImageFile(uploadFile())).resolves.toMatchObject({
      type: "image/webp",
    });
    expect(mocks.readFile).toHaveBeenCalledTimes(1);
  });

  it("reports a non-zero FFmpeg exit code without reading a missing output", async () => {
    mocks.exec.mockResolvedValue(7);

    await expect(convertReceiptImageFile(uploadFile()))
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

    await expect(convertReceiptImageFile(uploadFile()))
      .rejects.toThrow(expected);
    expect(mocks.deleteFile).toHaveBeenCalledTimes(2);
  });

  it("includes the latest relevant FFmpeg log and removes the listener", async () => {
    mocks.exec.mockResolvedValue(1);
    mocks.on.mockImplementation((_event, callback) => {
      callback({ type: "stdout", message: "frame=1" });
      callback({ type: "fferr", message: "Invalid data found when processing input" });
    });

    await expect(convertReceiptImageFile(uploadFile()))
      .rejects.toThrow(/FFmpeg log: fferr: Invalid data found when processing input/);
    expect(mocks.off).toHaveBeenCalledTimes(1);
  });

  it("does not accumulate log listeners across conversions", async () => {
    await convertReceiptImageFile(uploadFile());
    await convertReceiptImageFile(uploadFile());

    expect(mocks.on).toHaveBeenCalledTimes(2);
    expect(mocks.off).toHaveBeenCalledTimes(2);
  });

  it("normalizes arbitrary thrown values with useful messages", () => {
    expect(normalizeErrorMessage("worker failed")).toBe("worker failed");
    expect(normalizeErrorMessage(12)).toBe("12");
    expect(normalizeErrorMessage({ reason: "bad input" })).toBe('{"reason":"bad input"}');
  });
});
