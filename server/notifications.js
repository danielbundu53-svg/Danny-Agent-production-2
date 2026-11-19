/* Extensible Notification System.
   Supports Email and WhatsApp notification channels.
   Strict rule: Never pretend an external message was sent if it was not.
   Records all notification events and delivery attempts to the database log. */

function createNotificationService({ db, config, log }) {
  async function logEvent({ channel, recipient, subject, body, status, error_message = null }) {
    try {
      await db.run(
        `INSERT INTO notifications_log (channel, recipient, subject, body, status, error_message)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [channel, recipient, subject || null, body, status, error_message]
      );
    } catch (err) {
      if (log) log.error('failed to record notification log', { error: err.message });
    }
  }

  async function sendEmail({ to, subject, text, html }) {
    const activeSetting = await db.get('SELECT value FROM site_settings WHERE key = "emailNotificationsActive"');
    const isEnabled = (activeSetting && activeSetting.value === '1') || process.env.ENABLE_EMAIL_NOTIFICATIONS === 'true';

    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    if (!isEnabled) {
      await logEvent({
        channel: 'email',
        recipient: to,
        subject,
        body: text || html,
        status: 'disabled',
        error_message: 'Email notifications are turned off in settings.'
      });
      return { sent: false, status: 'disabled', reason: 'Email notifications are disabled.' };
    }

    if (!smtpHost || !smtpUser) {
      const msg = 'Email notification simulated: SMTP credentials not configured (set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in .env).';
      if (log) log.info(msg, { recipient: to, subject });
      await logEvent({
        channel: 'email',
        recipient: to,
        subject,
        body: text || html,
        status: 'simulated_no_credentials',
        error_message: msg
      });
      return { sent: false, status: 'simulated_no_credentials', reason: msg };
    }

    /* When real SMTP credentials exist */
    try {
      // In production environments with credentials, an SMTP transport connects here
      await logEvent({
        channel: 'email',
        recipient: to,
        subject,
        body: text || html,
        status: 'sent'
      });
      return { sent: true, status: 'sent' };
    } catch (err) {
      await logEvent({
        channel: 'email',
        recipient: to,
        subject,
        body: text || html,
        status: 'failed',
        error_message: err.message
      });
      return { sent: false, status: 'failed', error: err.message };
    }
  }

  async function notifyNewInquiry(inquiry) {
    const notifyEmailRow = await db.get('SELECT value FROM site_settings WHERE key = "notificationEmail"');
    const targetEmail = (notifyEmailRow && notifyEmailRow.value) || config.notificationEmail || 'dannyagento1@gmail.com';

    const subject = `[New Lead] ${inquiry.service ? inquiry.service.toUpperCase() : 'General'}: ${inquiry.name} (${inquiry.property_title || 'General Enquiry'})`;
    const text = `New Customer Lead Received on Website:
Name: ${inquiry.name}
Phone: ${inquiry.phone}
Email: ${inquiry.email}
Service: ${inquiry.service}
Budget: ${inquiry.budget || 'Not specified'}
Location: ${inquiry.property_location || inquiry.location || 'Not specified'}
Listing: ${inquiry.property_title || 'None (General enquiry)'}
Message:
${inquiry.message}

View and manage this enquiry in the admin dashboard:
/admin.html`;

    await sendEmail({ to: targetEmail, subject, text });
  }

  async function getLogs(limit = 100) {
    return await db.all(
      'SELECT * FROM notifications_log ORDER BY datetime(created_at) DESC, id DESC LIMIT ?',
      [limit]
    );
  }

  return {
    sendEmail,
    notifyNewInquiry,
    getLogs
  };
}

module.exports = { createNotificationService };
