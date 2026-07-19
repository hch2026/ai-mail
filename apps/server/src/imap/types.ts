export interface AttachmentMetadata {
  filename: string | null;
  contentType: string;
  size: number | null;
  part?: string | null;
  contentId?: string | null;
  disposition?: "attachment" | "inline" | "unknown";
}

export interface ImapMessageMetadata {
  uid: number;
  messageId: string | null;
  fromName: string | null;
  fromAddress: string | null;
  subject: string | null;
  sentAt: Date | null;
  internalDate: Date | null;
  size: number | null;
  flags: string[];
  imapLabels: string[];
  isUnread: boolean;
  textPart: string | null;
  htmlPart: string | null;
  attachments: AttachmentMetadata[];
}

export interface FlagUpdate {
  uid: number;
  flags: string[];
  labels: string[];
}

export interface MailboxSnapshot {
  path: string;
  uidValidity: string;
  highestModseq: string | null;
}

export interface ReadOnlyMailboxSession {
  snapshot: MailboxSnapshot;
  searchNewUids(afterUid: number): Promise<number[]>;
  fetchMetadata(uids: number[]): Promise<ImapMessageMetadata[]>;
  fetchChangedFlags(changedSince: string): Promise<FlagUpdate[]>;
  fetchAllFlags(pageSize: number): Promise<FlagUpdate[]>;
  fetchBodyPart(uid: number, part: string, maxBytes: number): Promise<BodyPartContent>;
}

export interface BodyPartContent {
  content: Buffer;
  contentType: string;
  charset: string | null;
}

export interface ImapConnection {
  connect(): Promise<void>;
  close(): Promise<void>;
  withReadOnlyMailbox<T>(callback: (session: ReadOnlyMailboxSession) => Promise<T>): Promise<T>;
  moveMessagesToTrash?(input: MailboxMoveRequest): Promise<MailboxMoveResult>;
  waitForChange(timeoutMs: number): Promise<boolean>;
}

export interface MailboxMoveRequest {
  mailbox: string;
  uidValidity: string;
  uids: number[];
}

export interface MailboxMoveResult {
  moved: number;
  targetMailbox: string;
}

export type ImapConnectionFactory = (accountKey?: string) => ImapConnection;
