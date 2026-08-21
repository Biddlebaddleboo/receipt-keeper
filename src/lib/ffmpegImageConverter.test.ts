import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildJpegConversionArguments,
  convertImageBlobToJpeg,
  JPEG_DOWNLOAD_MAX_WIDTH,
  JPEG_DOWNLOAD_QUALITY,
} from "@/lib/ffmpegImageConverter";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  writeFile: vi.fn(),
  exec: vi.fn(),
  readFile: vi.fn(),
  deleteFile: vi.fn(),
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
  },
}));

vi.mock("@ffmpeg/util", () => ({ fetchFile: mocks.fetchFile }));

describe("download JPEG conversion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.load.mockResolvedValue(undefined);
    mocks.fetchFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.readFile.mockResolvedValue(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    mocks.deleteFile.mockResolvedValue(undefined);
  });

  it("uses a conditional 1200px max width without upscaling smaller images", () => {
    const args = buildJpegConversionArguments("input.webp", "output.jpg");

    expect(JPEG_DOWNLOAD_MAX_WIDTH).toBe(1200);
    expect(args).toContain("scale='if(gt(iw,1200),1200,iw)':-2");
    expect(args).toContain("-frames:v");
  });

  it("encodes downloaded JPEGs with MJPEG quality 7", async () => {
    const output = await convertImageBlobToJpeg(new Blob(["webp"], { type: "image/webp" }));

    expect(JPEG_DOWNLOAD_QUALITY).toBe(7);
    expect(output.type).toBe("image/jpeg");
    expect(mocks.exec).toHaveBeenCalledWith(expect.arrayContaining([
      "-vf",
      "scale='if(gt(iw,1200),1200,iw)':-2",
      "-c:v",
      "mjpeg",
      "-q:v",
      "7",
    ]));
    expect(mocks.deleteFile).toHaveBeenCalledTimes(2);
  });
});
