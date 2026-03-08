const Ticket = require('../models/Ticket');
const Booking = require('../models/Booking');
const Event = require('../models/Event');
const PDFDocument = require('pdfkit');

// @desc    Get user's tickets
// @route   GET /api/tickets/my-tickets
// @access  Private
const getMyTickets = async (req, res) => {
  try {
    const tickets = await Ticket.find({ user: req.user.id })
      .populate('event', 'title date location')
      .sort('-createdAt');
    res.json(tickets);
  } catch (error) {
    console.error('Error in getMyTickets:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Download ticket PDF
// @route   GET /api/tickets/:id/download
// @access  Private
const downloadTicket = async (req, res) => {
  try {
    let tickets = [];
    let event = null;
    let user = null;

    // 1. Try to find a single Ticket
    const singleTicket = await Ticket.findById(req.params.id).populate('event user');
    
    if (singleTicket) {
      // Authorization Check
      if (singleTicket.user._id.toString() !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Not authorized' });
      }
      tickets = [singleTicket];
      event = singleTicket.event;
      user = singleTicket.user;
    } else {
      // 2. Try to find a Booking
      const booking = await Booking.findById(req.params.id).populate('event user');
      if (!booking) {
        return res.status(404).json({ message: 'Ticket or Booking not found' });
      }

      // Authorization Check
      if (booking.user._id.toString() !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Not authorized' });
      }

      // Fetch all tickets associated with this booking
      tickets = await Ticket.find({ 
        user: booking.user._id, 
        event: booking.event._id,
        paymentId: booking.stripeSessionId
      });
      
      event = booking.event;
      user = booking.user;
    }

    if (tickets.length === 0) {
      return res.status(404).json({ message: 'No tickets found for this booking' });
    }

    const axios = require('axios');
    const doc = new PDFDocument({ margin: 0, size: 'A4' });
    
    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=tickets-${event.title.replace(/\s+/g, '-').toLowerCase()}.pdf`);
    
    doc.pipe(res);

    for (let index = 0; index < tickets.length; index++) {
      const ticket = tickets[index];
      if (index > 0) doc.addPage();

      // Background Color
      doc.rect(0, 0, 595.28, 841.89).fill('#f8fafc');

      // Banner Image (Full width at top)
      if (event.bannerImage?.url) {
        try {
          const response = await axios.get(event.bannerImage.url, { responseType: 'arraybuffer' });
          const buffer = Buffer.from(response.data, 'binary');
          doc.image(buffer, 0, 0, { width: 595.28, height: 200 });
        } catch (e) {
          console.error('Failed to load banner image for PDF:', e.message);
          doc.rect(0, 0, 595.28, 200).fill('#6366f1');
        }
      } else {
        doc.rect(0, 0, 595.28, 200).fill('#6366f1');
      }

      // Ticket Header Over Banner
      doc.fillColor('#ffffff').fontSize(32).font('Helvetica-Bold').text('EVENT TICKET', 40, 70);
      doc.fontSize(12).font('Helvetica').text(`Ticket ${index + 1} of ${tickets.length}`, 40, 110);

      // Main Content Area
      doc.rect(40, 160, 515.28, 600).fill('#ffffff');
      doc.rect(40, 160, 515.28, 600).stroke('#e2e8f0');

      // Event Details
      doc.fillColor('#1e293b').fontSize(24).font('Helvetica-Bold').text(event.title, 60, 190, { width: 475 });
      
      doc.moveDown(1);
      doc.fillColor('#64748b').fontSize(10).font('Helvetica-Bold').text('DATE & TIME', 60, doc.y);
      doc.fillColor('#1e293b').fontSize(14).font('Helvetica').text(new Date(event.date).toLocaleString(), 60, doc.y + 5);
      
      doc.moveDown(1.5);
      doc.fillColor('#64748b').fontSize(10).font('Helvetica-Bold').text('LOCATION', 60, doc.y);
      doc.fillColor('#1e293b').fontSize(14).font('Helvetica').text(event.location, 60, doc.y + 5);

      doc.moveDown(1.5);
      doc.fillColor('#64748b').fontSize(10).font('Helvetica-Bold').text('ATTENDEE', 60, doc.y);
      doc.fillColor('#1e293b').fontSize(14).font('Helvetica').text(user.name, 60, doc.y + 5);

      doc.moveDown(1.5);
      doc.fillColor('#64748b').fontSize(10).font('Helvetica-Bold').text('TICKET NUMBER', 60, doc.y);
      doc.fillColor('#1e293b').fontSize(14).font('Helvetica').text(ticket.ticketNumber, 60, doc.y + 5);

      // QR Code Section
      if (ticket.qrCode) {
        const base64Data = ticket.qrCode.split(',')[1];
        if (base64Data) {
          const qrBuffer = Buffer.from(base64Data, 'base64');
          doc.image(qrBuffer, 375, 450, { width: 150, height: 150 });
          
          doc.fillColor('#64748b').fontSize(8).font('Helvetica').text('SCAN TO VERIFY', 375, 610, { width: 150, align: 'center' });
        }
      }

      // Footer
      doc.fillColor('#94a3b8').fontSize(9).font('Helvetica').text('This ticket is valid for one-time entry. No refunds. Powered by EventBoost-Pro.', 60, 720, { width: 475, align: 'center' });
      
      // Indigo border line at bottom
      doc.rect(40, 760, 515.28, 5).fill('#6366f1');
    }

    doc.end();
  } catch (error) {
    console.error('Error in downloadTicket:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  getMyTickets,
  downloadTicket
};
