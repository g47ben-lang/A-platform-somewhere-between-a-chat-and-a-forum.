export type MemberStatus = 'pending' | 'active' | 'banned';
export type MemberRole = 'member' | 'moderator' | 'admin';

export interface Profile {
  id: string;
  display_name: string;
  status: MemberStatus;
  role: MemberRole;
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
  author_id: string;
  title: string;
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
  author_id: string;
  reply_to: number | null;
  body: string;
  deleted: boolean;
  created_at: string;
  edited_at: string | null;
}

export interface Reaction {
  message_id: number;
  user_id: string;
  emoji: string;
}
