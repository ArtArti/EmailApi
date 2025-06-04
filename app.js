const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors());

// Rate limiting - 10 emails per 15 minutes per IP
const emailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: {
    error: 'Too many email requests, please try again later.'
  }
});

// Email validation function
const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Create transporter based on service
const createTransporter = (service = 'gmail') => {
  const config = {
    gmail: {
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD // Use App Password, not regular password
      }
    },
    outlook: {
      service: 'hotmail',
      auth: {
        user: process.env.OUTLOOK_USER,
        pass: process.env.OUTLOOK_PASSWORD
      }
    },
    smtp: {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      }
    }
  };
  
  return nodemailer.createTransport(config[service] || config.gmail);

};

// Routes

// Root route for Vercel
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Art Gallery Email API is running',
    endpoints: ['/health', '/send-email', '/send-bulk-email', '/send-template-email']
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Email API is running' });
});

// Send single email
app.post('/send-email', emailLimiter, async (req, res) => {
  try {
    const { 
      to, 
      subject, 
      text, 
      html, 
      from, 
      service = 'gmail',
      attachments = []
    } = req.body;

    // Validation
    if (!to || !subject || (!text && !html)) {
      return res.status(400).json({
        error: 'Missing required fields: to, subject, and either text or html'
      });
    }

    if (!validateEmail(to)) {
      return res.status(400).json({
        error: 'Invalid recipient email address'
      });
    }

    if (from && !validateEmail(from)) {
      return res.status(400).json({
        error: 'Invalid sender email address'
      });
    }

    // Create transporter
    const transporter = createTransporter(service);

    // Email options
    const mailOptions = {
      from: from || process.env.DEFAULT_FROM_EMAIL || process.env.GMAIL_USER,
      to: to,
      subject: subject,
      text: text,
      html: html,
      attachments: attachments
    };

    // Send email
    const info = await transporter.sendMail(mailOptions);

    res.json({
      success: true,
      message: 'Email sent successfully',
      messageId: info.messageId,
      response: info.response
    });

  } catch (error) {
    console.error('Email sending error:', error);
    res.status(500).json({
      error: 'Failed to send email',
      details: error.message
    });
  }
});

// Send bulk emails
app.post('/send-bulk-email', emailLimiter, async (req, res) => {
  try {
    const { 
      recipients, 
      subject, 
      text, 
      html, 
      from, 
      service = 'gmail' 
    } = req.body;

    // Validation
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({
        error: 'Recipients array is required and cannot be empty'
      });
    }

    if (!subject || (!text && !html)) {
      return res.status(400).json({
        error: 'Missing required fields: subject, and either text or html'
      });
    }

    // Validate all email addresses
    const invalidEmails = recipients.filter(email => !validateEmail(email));
    if (invalidEmails.length > 0) {
      return res.status(400).json({
        error: 'Invalid email addresses found',
        invalidEmails: invalidEmails
      });
    }

    // Limit bulk email size
    if (recipients.length > 50) {
      return res.status(400).json({
        error: 'Maximum 50 recipients allowed per bulk email'
      });
    }

    // Create transporter
    const transporter = createTransporter(service);

    // Send emails
    const results = [];
    const errors = [];

    for (const recipient of recipients) {
      try {
        const mailOptions = {
          from: from || process.env.DEFAULT_FROM_EMAIL || process.env.GMAIL_USER,
          to: recipient,
          subject: subject,
          text: text,
          html: html
        };

        const info = await transporter.sendMail(mailOptions);
        results.push({
          email: recipient,
          success: true,
          messageId: info.messageId
        });
      } catch (error) {
        errors.push({
          email: recipient,
          success: false,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      message: `Bulk email completed. ${results.length} sent, ${errors.length} failed`,
      results: results,
      errors: errors
    });

  } catch (error) {
    console.error('Bulk email sending error:', error);
    res.status(500).json({
      error: 'Failed to send bulk emails',
      details: error.message
    });
  }
});

// Send email with template
app.post('/send-template-email', emailLimiter, async (req, res) => {
  try {
    const { 
      to, 
      template, 
      variables = {}, 
      service = 'gmail',
      from 
    } = req.body;

    // Validation
    if (!to || !template) {
      return res.status(400).json({
        error: 'Missing required fields: to, template'
      });
    }

    if (!validateEmail(to)) {
      return res.status(400).json({
        error: 'Invalid recipient email address'
      });
    }

    // Simple template system
    const templates = {
      welcome: {
        subject: 'Welcome to {{appName}}!',
        html: `
          <h1>Welcome {{name}}!</h1>
          <p>Thank you for joining {{appName}}. We're excited to have you on board!</p>
          <p>Best regards,<br>The {{appName}} Team</p>
        `
      },
      art_submission: {
        subject: 'New Order Received for Your Artwork on Art_Gallery!',
        html: `
          <h2>Hello Seller</h2>

          <p>Great news! You've received a new order for your artwork on <strong>Art_Gallery</strong>.</p>

          <h3>🎨 Artwork Details:</h3>
          <img src="{{imageUrl}}" alt="Artwork image" style="max-width: 100%; height: auto; border: 1px solid #ddd; padding: 4px;" />

          <ul>
            <li><strong>Description:</strong> {{description}}</li>
            <li><strong>Dimensions:</strong> {{dimensions}}</li>
            <li><strong>Medium:</strong> {{medium}}</li>
          </ul>

          <h3>🧾 Buyer Details:</h3>
          <ul>
            <li><strong>Full Name:</strong> {{buyerName}}</li>
            <li><strong>Email:</strong> {{buyerEmail}}</li>
            <li><strong>Shipping Address:</strong> {{address}}</li>
          </ul>
        `
      },
      reset_password: {
        subject: 'Password Reset Request',
        html: `
          <h1>Password Reset</h1>
          <p>Hi {{name}},</p>
          <p>You requested a password reset. Click the link below to reset your password:</p>
          <p><a href="{{resetLink}}">Reset Password</a></p>
          <p>If you didn't request this, please ignore this email.</p>
        `
      },
      notification: {
        subject: '{{subject}}',
        html: `
          <h1>{{title}}</h1>
          <p>{{message}}</p>
          <p>Best regards,<br>{{senderName}}</p>
        `
      }
    };

    const selectedTemplate = templates[template];
    if (!selectedTemplate) {
      return res.status(400).json({
        error: 'Template not found',
        availableTemplates: Object.keys(templates)
      });
    }

    // Replace variables in template
    let subject = selectedTemplate.subject;
    let html = selectedTemplate.html;

    Object.keys(variables).forEach(key => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      subject = subject.replace(regex, variables[key] || '');
      html = html.replace(regex, variables[key] || '');
    });

    // Create transporter
    const transporter = createTransporter(service);

    // Email options
    const mailOptions = {
      from: from || process.env.DEFAULT_FROM_EMAIL || process.env.GMAIL_USER,
      to: to,
      subject: subject,
      html: html
    };

    // Send email
    const info = await transporter.sendMail(mailOptions);

    res.json({
      success: true,
      message: 'Template email sent successfully',
      messageId: info.messageId,
      template: template
    });

  } catch (error) {
    console.error('Template email sending error:', error);
    res.status(500).json({
      error: 'Failed to send template email',
      details: error.message
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({
    error: 'Internal server error',
    details: error.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found'
  });
});

// For local development
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// Export for Vercel
module.exports = app;