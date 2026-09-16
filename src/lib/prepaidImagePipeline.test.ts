import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareAndUploadPrepaidImage } from "@/lib/prepaidImagePipeline";

const mocks = vi.hoisted(() => ({
  crop: vi.fn(),
  grayscale: vi.fn(),
  convert: vi.fn(),
}));

vi.mock("@/lib/receiptAutoCrop", () => ({ autoCropReceiptImage: mocks.crop }));
vi.mock("@/lib/nativeImageConverter", () => ({ convertImageFileToGrayscale: mocks.grayscale }));
vi.mock("@/lib/ffmpegImageConverter", () => ({ convertReceiptImageFile: mocks.convert }));

const input = () => new File(["input"], "card.jpg", { type: "image/jpeg" });
const webp = () => new File(["webp"], "card.webp", { type: "image/webp" });

describe("prepaid image pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.crop.mockImplementation(async (file: File) => file);
    mocks.grayscale.mockImplementation(async (file: File) => file);
    mocks.convert.mockResolvedValue(webp());
  });

  it("runs crop, optional grayscale, WebP conversion, then upload", async () => {
    const calls: string[] = [];
    mocks.crop.mockImplementation(async (file: File) => { calls.push("crop"); return file; });
    mocks.grayscale.mockImplementation(async (file: File) => { calls.push("grayscale"); return file; });
    mocks.convert.mockImplementation(async (file: File) => { calls.push("webp"); return webp(); });
    const upload = vi.fn(async () => { calls.push("upload"); return "prepaid/card-front.webp"; });

    const result = await prepareAndUploadPrepaidImage(input(), "card_front", { grayscale: true, upload });

    expect(calls).toEqual(["crop", "grayscale", "webp", "upload"]);
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ type: "image/webp" }), "card_front");
    expect(result.storagePath).toBe("prepaid/card-front.webp");
  });

  it("fails open when crop rejects and still converts the original file", async () => {
    mocks.crop.mockRejectedValue(new Error("detector unavailable"));
    const upload = vi.fn(async () => "prepaid/package.webp");

    await expect(prepareAndUploadPrepaidImage(input(), "package", { upload })).resolves.toMatchObject({
      storagePath: "prepaid/package.webp",
    });
    expect(mocks.convert).toHaveBeenCalledWith(expect.objectContaining({ name: "card.jpg" }));
  });

  it("rejects a converter result that is not WebP before upload", async () => {
    mocks.convert.mockResolvedValue(new File(["jpeg"], "card.jpg", { type: "image/jpeg" }));
    const upload = vi.fn();

    await expect(prepareAndUploadPrepaidImage(input(), "card_back", { upload })).rejects.toThrow(/image\/webp/);
    expect(upload).not.toHaveBeenCalled();
  });
});
