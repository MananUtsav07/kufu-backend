import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchAndExtractPage } from "../src/rag/crawler.js";

vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
  },
}));

describe("crawler fetch fallbacks", () => {
  const mockedAxiosGet = vi.mocked(axios.get);

  beforeEach(() => {
    mockedAxiosGet.mockReset();
    process.env.ENABLE_PLAYWRIGHT = "false";
    delete process.env.JINA_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses Jina extraction when available", async () => {
    mockedAxiosGet.mockResolvedValueOnce({
      data: "Extracted with Jina",
    } as never);

    const page = await fetchAndExtractPage({
      url: "https://example.com",
    });

    expect(page.contentText).toBe("Extracted with Jina");
    expect(page.httpStatus).toBe(200);
    expect(mockedAxiosGet).toHaveBeenCalledTimes(1);
    expect(mockedAxiosGet.mock.calls[0]?.[0]).toBe(
      "https://r.jina.ai/https://example.com",
    );
  });

  it("falls back to direct html extraction when Jina fails", async () => {
    mockedAxiosGet
      .mockRejectedValueOnce(new Error("Jina unavailable"))
      .mockResolvedValueOnce({
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
        data: `
          <html>
            <head><title>Cook Craft</title></head>
            <body>
              <h1>Welcome</h1>
              <p>Fresh recipes for busy evenings.</p>
            </body>
          </html>
        `,
      } as never);

    const page = await fetchAndExtractPage({
      url: "https://example.com",
    });

    expect(page.title).toBe("Cook Craft");
    expect(page.contentText).toContain("Welcome");
    expect(page.contentText).toContain("Fresh recipes for busy evenings.");
    expect(page.httpStatus).toBe(200);
    expect(mockedAxiosGet).toHaveBeenCalledTimes(2);
  });
});
