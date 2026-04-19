export type ApprovalStatus = "approved" | "edited" | "rejected" | "timeout";

export interface ApprovalDecision {
  status: ApprovalStatus;
  /** The text actually sent (undefined if rejected or timed out) */
  sentText?: string;
  /** The original draft (populated when edited or rejected) */
  originalDraft?: string;
}

export interface PendingApproval {
  groupJid: string;
  draft: string;
  resolve: (decision: ApprovalDecision) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

export interface ApprovedEntry {
  date: string;
  alias: string;
  question: string;
  status: "approved" | "edited" | "rejected";
  sentText?: string;
  originalDraft?: string;
}

export interface AgentTurn {
  groupJid: string;
  mentionText: string;
  recentContextMessages: string[];
  quotedMessage: import("@whiskeysockets/baileys").WAMessage;
}

export interface BotConfig {
  autonomousMode: boolean;
  approvalTimeoutMs: number;
  maxContextMessages: number;
  queueDepthMax: number;
  maxInboundMessageChars: number;
}
