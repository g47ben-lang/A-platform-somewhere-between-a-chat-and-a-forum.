export type MemberStatus = 'pending' | 'active' | 'banned';
export type MemberRole = 'member' | 'moderator' | 'admin';

export interface Profile {
  id: string;
  display_name: string;
  status: MemberStatus;
  role: MemberRole;
  bio: string | null;
  accept_anonymous: boolean;
  created_at: string;
}

export interface Channel {
  id: number;
  name: string;
  description: string | null;
  position: number;
  admin_only_post: boolean;
}

export interface Thread {
  id: number;
  channel_id: number;
  author_id: string | null;
  anonymous: boolean;
  title: string | null;
  body: string | null;
  pinned: boolean;
  locked: boolean;
  message_count: number;
  created_at: string;
  last_activity_at: string;
}

export interface Message {
  id: number;
  thread_id: number;
  author_id: string | null;
  anonymous: boolean;
  reply_to: number | null;
  body: string;
  deleted: boolean;
  created_at: string;
  edited_at: string | null;
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
  body: string;
  deleted: boolean;
  created_at: string;
  edited_at: string | null;
}

export interface MemberStats {
  id: string;
  threads: number;
  replies: number;
  likes: number;
  reputation: number;
}
