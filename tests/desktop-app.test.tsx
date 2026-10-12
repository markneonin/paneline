import { describe, expect, test } from "claude-code/testing";

const FENCED_REPLY = "```ts\nconst answer = 42\n```";
const ENGINE_DRAWING = "the desktop app drew this reply";

describe("desktop app", () => {
  test("D1 a reply with a code block is left to the desktop app to draw", async ($, on) => {
    on("ui.render", { component: "AssistantMessage" }, ($, e) => {
      const { Text } = $.ui.resolve(e);
      return <Text>{ENGINE_DRAWING}</Text>;
    });

    const ui = await $.ui.mount({
      plugin: "paneline",
      surface: "desktop",
      component: "AssistantMessage",
      props: { text: FENCED_REPLY, isFirstOfReply: true },
    });

    expect(await ui.find({ type: "Text", text: ENGINE_DRAWING })).toBeDefined();
    expect(await ui.find({ type: "Code" })).toBeUndefined();
  });
});
