import {
  applyStoryboardAction,
  DESKTOP_VIEWPORT,
  renderStoryboardGuide,
  type StoryboardConfig,
} from "../../src/ui";
import scenario, { scenarioRunOptions } from "../../src/cli-module";

const config: StoryboardConfig = {
  title: "Demo guide",
  intro: "An introduction.",
  guideFile: "docs/guide.md",
  screenshotsDir: "docs/images",
  sections: [{ title: "Getting started", intro: "Start here." }],
  scenarios: [],
};

describe("storyboard guide", () => {
  it("renders ordered sections, relative images, and safe table cells", () => {
    const results: any = [{ iterationMetrics: [
      { meta: { scenarioId: "login", section: "Getting started", title: "Sign in", description: "Use a | valid account\non two lines", notes: ["Keep this private"], alt: "Login screen" } },
      { meta: { scenarioId: "home", section: "Getting started", title: "Home", description: "The dashboard", notes: [], alt: "Home" } },
    ] }];
    expect(renderStoryboardGuide(config, results)).toBe([
      "# Demo guide", "", "An introduction.", "", "## Table of Contents", "- [Getting started](#getting-started)", "", "# Getting started", "", "Start here.", "", "|  |  |", "| --- | --- |", "| ![Login screen](./images/login.png) | **Sign in**<br><br>Use a \\| valid account<br>on two lines<br><br>**Notes**<br>- Keep this private |", "| **Home**<br><br>The dashboard | ![Home](./images/home.png) |", "",
    ].join("\n"));
  });
});

describe("storyboard actions", () => {
  it("uses the requested locator occurrence and timeout", async () => {
    const click = jest.fn();
    const locator = { nth: jest.fn(() => ({ click })), first: jest.fn(), filter: jest.fn() };
    const page: any = { locator: jest.fn(() => locator) };
    await applyStoryboardAction(page, { type: "click", selector: ".save", nth: 2, timeout: 123 });
    expect(locator.nth).toHaveBeenCalledWith(2);
    expect(click).toHaveBeenCalledWith({ timeout: 123 });
  });
});

describe("scenario CLI options", () => {
  it("overrides portable storyboard output settings without changing its scenarios", () => {
    const resolved = scenarioRunOptions({ ...config, scenarios: [{ id: "one", section: "A", title: "A", route: "/" }] }, { baseUrl: "http://localhost:4200", guideFile: "out/tutorial.md", screenshotsDir: "out/shots", timeout: "5000" });
    expect(resolved).toMatchObject({ baseUrl: "http://localhost:4200", guideFile: "out/tutorial.md", screenshotsDir: "out/shots", scenarioTimeoutMs: 5000 });
    expect(resolved.scenarios).toHaveLength(1);
    expect(DESKTOP_VIEWPORT).toEqual({ width: 1440, height: 900 });
  });

  it("registers scenario as the module name and run as its command", () => {
    const module = scenario();
    expect(module.name()).toBe("scenario");
    expect(module.commands[0].name()).toBe("run");
    expect(module.commands[0].options.map((option: any) => option.long)).toEqual(expect.arrayContaining(["--base-url", "--guide-file", "--screenshots-dir", "--browser", "--headed", "--timeout"]));
  });
});
