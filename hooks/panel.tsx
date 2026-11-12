import type { ElementTable, RenderElement } from "claude-code";

import type { ReplyLook } from "./reply-look";

type PanelSpec = {
  key: string;
  width: number;
  look: ReplyLook;
  title: RenderElement;
  isTitlePressable?: boolean;
  right?: RenderElement[];
  body?: RenderElement;
  hiddenLines?: number;
  background?: string;
};

export function panel(ui: ElementTable, spec: PanelSpec): RenderElement {
  const { Box } = ui;
  return (
    <Box key={spec.key} flexDirection="column" width={spec.width}>
      {band(ui, spec)}
      {spec.body === undefined ? null : bodyView(ui, spec.body, spec)}
    </Box>
  );
}

function band(
  ui: ElementTable,
  { look, title, isTitlePressable = false, right = [], width }: PanelSpec,
): RenderElement {
  const { Box, Text } = ui;
  const mark = [
    <Text key="bar" color={look.accent} backgroundColor={look.band}>
      ▌
    </Text>,
    <Text key="gap" backgroundColor={look.band}>
      {" "}
    </Text>,
  ];
  return (
    <Box flexDirection="row" width={width} backgroundColor={look.band}>
      <Box flexGrow={1} flexShrink={1} minWidth={0} backgroundColor={look.band}>
        {isTitlePressable ? (
          <Box flexDirection="row" backgroundColor={look.band}>
            {mark}
            {title}
          </Box>
        ) : (
          <Text wrap="truncate-start" backgroundColor={look.band}>
            {mark}
            {title}
          </Text>
        )}
      </Box>
      {right.length === 0 ? null : (
        <Box
          flexShrink={0}
          columnGap={2}
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={look.band}
        >
          {right}
        </Box>
      )}
    </Box>
  );
}

function bodyView(
  ui: ElementTable,
  body: RenderElement,
  { look, hiddenLines = 0, background }: PanelSpec,
): RenderElement {
  const { Box, Text } = ui;
  const padding =
    background === undefined ? { paddingLeft: 2, paddingTop: 1 } : { paddingX: 2, paddingY: 1 };
  return (
    <Box flexDirection="column" backgroundColor={background} {...padding}>
      {body}
      {hiddenLines > 0 ? <Text color={look.muted}>{`… +${hiddenLines} lines`}</Text> : null}
    </Box>
  );
}
