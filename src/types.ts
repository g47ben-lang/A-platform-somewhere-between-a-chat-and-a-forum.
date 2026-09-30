export type MemberStatus = 'pending' | 'active' | 'banned';
export type MemberRole = 'member' | 'inspector' | 'moderator' | 'admin';

export interface Profile {
  id: string;
  display_name: string;
  status: MemberStatus;
  role: MemberRole;
  bio: string | null;
  accept_anonymous: boolean;
  can_send_anonymous: boolean;
  avatar_path: string | null;
  terms_accepted_at: string | null;
  /** How the account got in without waiting for approval. */
  joined_via: 'email' | 'roster' | null;
  /** false until an admin looks at a join by roster name. */
  join_seen: boolean;
  created_at: string;
}

/** A chat room as returned by my_rooms(). */
export interface Room {
  id: number;
  name: string;
  description: string | null;
  is_main: boolean;
  admin_only_post: boolean;
  created_by: string | null;
  last_message_at: string;
  unread: number;
  last_body: string | null;
  last_author: string | null;
  last_anonymous: boolean | null;
}

/** A photo or short video stored in the private "media" bucket. */
export interface Attachment {
  type: 'image' | 'video';
  path: string;
  width?: number;
  height?: number;
  size?: number;
  duration?: number;
}

export interface Message {
  id: number;
  channel_id: number;
  author_id: string | null;
  anonymous: boolean;
  reply_to: number | null;
  body: string;
  deleted: boolean;
  created_at: string;
  edited_at: string | null;
  attachment: Attachment | null;
  forwarded: boolean;
  pinned_at: string | null;
  pinned_by: string | null;
  /** Set on the automatic announcement of a poll. */
  poll_id: number | null;
}

export interface Poll {
  id: number;
  author_id: string | null;
  question: string;
  multi: boolean;
  closed: boolean;
  created_at: string;
}

export interface PollOption {
  id: number;
  poll_id: number;
  position: number;
  label: string;
}

export interface WallPost {
  id: number;
  profile_id: string;
  author_id: string | null;
  anonymous: boolean;
  body: string;
  created_at: string;
}

export interface Conversation {
  id: number;
  anonymous: boolean;
  i_am_hidden: boolean;
  other_id: string | null;
  closed: boolean;
  last_message_at: string;
  last_body: string | null;
  last_from_me: boolean | null;
  unread: number;
}

export interface DmMessage {
  id: number;
  conversation_id: number;
  sender_id: string | null;
  reply_to: number | null;
  body: string;
  deleted: boolean;
  created_at: string;
  edited_at: string | null;
  attachment: Attachment | null;
  forwarded: boolean;
}

/** Room reaction: always attributed. */
export interface Reaction {
  message_id: number;
  user_id: string;
  emoji: string;
}

/** DM reaction: user_id is null when made by the anonymous (hidden) side. */
export interface DmReaction {
  message_id: number;
  user_id: string | null;
  hidden: boolean;
  emoji: string;
}

export interface MemberStats {
  id: string;
  messages: number;
  likes: number;
  reputation: number;
}
