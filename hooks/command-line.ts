export function commandLine(text: string): string {
  const name = tagOf(text, "command-name").replace(/^\//, "");
  if (name === "") return "";
  return `/${name} ${tagOf(text, "command-args")}`.trim();
}

function tagOf(text: string, tag: string): string {
  return new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)?.[1]?.trim() ?? "";
}
