-- Remove only the old default seed when nobody has used it. Never delete
-- participant-created teams or a team with sessions or competition activity.
DELETE FROM teams
WHERE name = 'Demo Team' AND created_by IS NULL
  AND NOT EXISTS (SELECT 1 FROM sessions WHERE team_id = teams.id)
  AND NOT EXISTS (SELECT 1 FROM solves WHERE team_id = teams.id)
  AND NOT EXISTS (SELECT 1 FROM messages WHERE team_id = teams.id)
  AND NOT EXISTS (SELECT 1 FROM submissions WHERE team_id = teams.id)
  AND NOT EXISTS (SELECT 1 FROM chat_operations WHERE team_id = teams.id)
  AND NOT EXISTS (SELECT 1 FROM exploit_events WHERE actor_team_id = teams.id);
