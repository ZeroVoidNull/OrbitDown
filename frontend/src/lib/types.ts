export interface Torrent {
  hash: string;
  name: string;
  state: string;
  progress: number;
  size: number;
  total_size: number;
  dlspeed: number;
  upspeed: number;
  downloaded: number;
  uploaded: number;
  ratio: number;
  eta: number;
  category: string;
  tags: string;
  num_seeds: number;
  num_leechs: number;
  save_path: string;
  added_on: number;
  completion_on: number;
}
export interface Transfer {
  dl_info_speed: number;
  up_info_speed: number;
  dl_info_data: number;
  up_info_data: number;
  free_space_on_disk: number;
  connection_status: string;
  dht_nodes: number;
  dl_rate_limit: number;
  up_rate_limit: number;
  use_alt_speed_limits: boolean;
}
export interface MainData {
  rid: number;
  full_update?: boolean;
  torrents?: Record<string, Partial<Torrent>>;
  torrents_removed?: string[];
  server_state?: Partial<Transfer>;
  categories?: Record<string, { name: string; savePath: string }>;
  categories_removed?: string[];
  tags?: string[];
  tags_removed?: string[];
}
export interface Session {
  user: { name: string; username: string };
  instance: string;
}
export interface TorrentFile {
  index: number;
  name: string;
  size: number;
  progress: number;
  priority: number;
}
export interface Tracker {
  url: string;
  status: number;
  tier: number;
  num_peers: number;
  msg: string;
}
export interface TorrentProperties {
  save_path: string;
  total_size: number;
  total_downloaded: number;
  total_uploaded: number;
  creation_date: number;
  addition_date: number;
  completion_date: number;
  piece_size: number;
  pieces_have: number;
  pieces_num: number;
  comment: string;
  time_elapsed: number;
  seeding_time: number;
}
export type StatusKey =
  "all" | "downloading" | "seeding" | "paused" | "completed" | "error";
export interface Filters {
  search: string;
  status: StatusKey;
  category: string;
  tag: string;
  sort: "added" | "name" | "size" | "progress" | "speed";
}
