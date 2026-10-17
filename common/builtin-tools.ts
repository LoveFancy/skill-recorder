import { z } from "zod";

const Host = z.string().trim().min(1).max(253).regex(/^[a-zA-Z0-9.-]+$/, "请输入服务器域名或 IP");
export const MailAccountSchema = z.object({
  address: z.email(), username: z.string().trim().min(1).max(320),
  imapHost: Host, imapPort: z.number().int().min(1).max(65535).default(993),
  smtpHost: Host, smtpPort: z.number().int().min(1).max(65535).default(465),
});
export type MailAccount = z.infer<typeof MailAccountSchema>;
export type BuiltinToolsView = { mail: (MailAccount & { hasPassword: boolean }) | null };
export const BUILTIN_SERVERS = [
  { name: "recorder-browser", description: "内置 Playwright：浏览网页、读取页面与截图，使用独立浏览器资料目录" },
  { name: "recorder-mail", description: "内置邮箱：通过 IMAP 搜索和读取邮件，通过 SMTP 发送；深度分析只使用读取能力" },
] as const;
export function builtinToolAccess(server: string, tool: string): "read" | "write" | "unknown" {
  if (server === "recorder-browser" && ["browser_navigate", "browser_snapshot", "browser_screenshot"].includes(tool)) return "read";
  if (server === "recorder-browser" && ["browser_click", "browser_fill"].includes(tool)) return "write";
  if (server === "recorder-mail" && ["mail_search", "mail_read"].includes(tool)) return "read";
  if (server === "recorder-mail" && tool === "mail_send") return "write";
  return "unknown";
}
