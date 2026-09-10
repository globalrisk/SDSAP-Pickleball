create index if not exists rotation_matches_team_a_player_1_idx
  on public.rotation_matches (team_a_player_1_id);

create index if not exists rotation_matches_team_a_player_2_idx
  on public.rotation_matches (team_a_player_2_id);

create index if not exists rotation_matches_team_b_player_1_idx
  on public.rotation_matches (team_b_player_1_id);

create index if not exists rotation_matches_team_b_player_2_idx
  on public.rotation_matches (team_b_player_2_id);
