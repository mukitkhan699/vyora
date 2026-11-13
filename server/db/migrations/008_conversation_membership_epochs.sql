-- Version participant membership epochs so delayed realtime events cannot be
-- delivered to a user who left and later rejoined after the message was sent.
ALTER TABLE zunari_conversation_participants
  ADD COLUMN IF NOT EXISTS membership_epoch UUID NOT NULL DEFAULT gen_random_uuid();

CREATE OR REPLACE FUNCTION zunari_coordinate_conversation_membership_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM id
  FROM zunari_conversations_v2
  WHERE id = OLD.conversation_id
  FOR UPDATE;

  IF TG_OP = 'UPDATE'
     AND OLD.left_at IS NOT NULL
     AND NEW.left_at IS NULL THEN
    NEW.membership_epoch := gen_random_uuid();
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zunari_conversation_membership_lock
  ON zunari_conversation_participants;

CREATE TRIGGER zunari_conversation_membership_lock
BEFORE UPDATE OF left_at OR DELETE
ON zunari_conversation_participants
FOR EACH ROW
EXECUTE FUNCTION zunari_coordinate_conversation_membership_change();
