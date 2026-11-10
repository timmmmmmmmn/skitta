-- Snelle lijst met recente gesprekken (tabblad Bellen).
CREATE INDEX idx_messages_calls ON messages(conversation_id, id) WHERE kind = 'call';
