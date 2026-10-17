import { defineCatalogueProvider } from "../catalogue-provider";
export const CLAUDE_CODE_CATALOGUE_VERSION = "2026-10-14";
export default defineCatalogueProvider({
  architecture: "claude-code",
  skill: {
    version: CLAUDE_CODE_CATALOGUE_VERSION,
    content: `
# Target: Claude Code project skill — export only
Use standard SKILL.md name/description frontmatter and Markdown instructions.
Built-in target capabilities: Read, Write, Edit, Glob, Grep, Bash. These are target capabilities, not permissions for enhancement.
Dynamic project tools are a separate snapshot; include ONLY tools explicitly present in the supplied project manifest. Skill files are instructions, not callable MCP tools.
State the required project/MCP configuration and account/resource prerequisites. Do not imply this file configures or installs MCP.
Current values require runtime lookup; historical examples must not become constants. Only explicitly reviewed, scoped invariant rules can become fixed rules.
If a required project capability is missing or unverified, mark it as a dependency gap. Do not invent browser automation or MCP tools.
Export never installs or executes the skill. Business writes described for future use need their own user authorization.
`.trim(),
  },
});
