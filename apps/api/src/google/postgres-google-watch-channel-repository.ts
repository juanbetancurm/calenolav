import type { Pool } from "pg";
import type { GoogleCalendarNotificationRecord } from "./google-calendar-notification.js";

export class PostgresGoogleWatchChannelRepository {
  constructor(private readonly pool: Pool) {}

  async recordNotification(
    input: GoogleCalendarNotificationRecord,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE google_calendar_watch_channels
          SET last_message_number = $5::bigint,
              last_notification_at = $4,
              last_resource_state = $6,
              updated_at = $4
        WHERE channel_id = $1
          AND channel_token_hash = $2
          AND resource_id = $3
          AND expires_at > $4
          AND last_message_number < $5::bigint
      RETURNING channel_id`,
      [
        input.channelId,
        input.channelTokenHash,
        input.resourceId,
        input.receivedAt,
        input.messageNumber,
        input.resourceState,
      ],
    );
    return result.rowCount === 1;
  }
}
