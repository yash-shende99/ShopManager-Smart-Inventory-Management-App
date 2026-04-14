import Bill from "../models/Bill.js";
import Customer from "../models/Customer.js";
import nodemailer from 'nodemailer';

// Configure nodemailer transporter (update with your email service details)
const transporter = nodemailer.createTransport({
    service: 'gmail', // or your email service (yahoo, outlook, etc.)
    auth: {
        user: process.env.EMAIL_USER, // your email
        pass: process.env.EMAIL_PASS  // your email password or app password
    }
});

const addCustomer = async (req, res) => {

    try {
        const { customerName, phoneNumber, email } = req.body;
        const owner = req.user.email; // Get the authenticated user's email

        if (!customerName || !phoneNumber || !email) {
            return res.status(400).json({ message: "Please provide all required fields" });
        }
        const customer = new Customer({
            owner,
            customerName,
            phoneNumber,
            email
        });

        await customer.save();

        res.status(201).json({
            message: "Customer created successfully",
            customer
        });



    } catch (error) {
        console.error("Error creating customer:", error); // Log error for debugging
    }
}

const showCustomer = async (req, res) => {
    try {
        const owner = req.user.email; // Get the authenticated user's email
        const customerData = await Customer.find({ owner });
        res.status(200).json(customerData);
    } catch (error) {
        console.error("Error fetching customer data:", error);
        res.status(500).json({ 
            message: "Internal Server Error",
            error: error.message 
        });
    }
}


const sendNotificationbyDay = async (req, res) => {
    const owner = req.user.email;
    const {days}=req.body;

    try {
        const customerData = await Customer.find({ owner });

        // Array to store customer data with their latest bill info
        const customersWithBillInfo = [];
        const notificationPromises = [];

        // Process each customer to find their latest bill
        for (const customer of customerData) {

            // Find all bills for this specific customer
            const bills = await Bill.find({
                owner: req.user.email,
                customerId: customer._id.toString()
            }).sort({ date: -1 }); // Sort by date descending to get latest first


            if (bills.length > 0) {
                const latestBill = bills[0]; // First bill after sorting (most recent)                
                // Calculate days difference between today and latest bill date
                const today = new Date();
                const lastBillDate = new Date(latestBill.date);
                const timeDifference = today.getTime() - lastBillDate.getTime();
                const daysDifference = Math.floor(timeDifference / (1000 * 3600 * 24));

                // Calculate OVERALL remaining amount from ALL bills
                const overallRemainingAmount = bills.reduce((total, bill) => {
                    return total + (bill.grandTotal - bill.deposit);
                }, 0);
                
                // Add bill information to customer data
                customersWithBillInfo.push({
                    ...customer.toObject(),
                    latestBillDate: latestBill.date,
                    daysSinceLastBill: daysDifference,
                    overallRemainingAmount: overallRemainingAmount,
                    needsNotification: daysDifference >=days && overallRemainingAmount > 0
                });

                // Send notification if days > 5 AND there's overall remaining amount to pay
                if (daysDifference >= days && overallRemainingAmount > 0) {
                    const notificationPromise = sendNotificationEmail(customer, daysDifference, latestBill.date, overallRemainingAmount, bills);
                    notificationPromises.push(notificationPromise);
                }

            } else {
                customersWithBillInfo.push({
                    ...customer.toObject(),
                    latestBillDate: null,
                    daysSinceLastBill: null,
                    overallRemainingAmount: 0,
                    needsNotification: false
                });
            }
        }

        // Wait for all email notifications to be sent
        if (notificationPromises.length > 0) {
            await Promise.all(notificationPromises);
        }

        res.status(200).json({
            message: "Notification sent successfully",
            success:true
        });

    } catch (error) {
        console.error("Error fetching customer data:", error);
        res.status(500).json({ message: "Internal Server Error",success:false});
    }
}


// Updated email function with overall remaining amount
const sendNotificationEmail = async (customer, daysDifference, lastBillDate, overallRemainingAmount, bills) => {
    try {
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: customer.email, // Make sure customer has email field
            subject: `Payment Reminder: ${customer.customerName} - Outstanding Amount Rs. ${overallRemainingAmount}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #333;">Payment Reminder</h2>
                    <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px;">
                        <h3 style="color: #dc3545; margin-top: 0;">Outstanding Payment</h3>
                        <p><strong>Customer Name:</strong> ${customer.customerName}</p>
                        <p><strong>Phone Number:</strong> ${customer.phoneNumber || 'N/A'}</p>
                        <p><strong>Last Purchase Date:</strong> ${new Date(lastBillDate).toLocaleDateString()}</p>
                        <p><strong>Days Since Last Purchase:</strong> <span style="color: #dc3545; font-weight: bold;">${daysDifference} days</span></p>
                        
                        <!-- Overall Payment Details Section -->
                        <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 15px 0;">
                            <h4 style="color: #856404; margin: 0 0 15px 0;">Overall Payment Summary</h4>
                            
                            <div style="text-align: center; padding: 10px; background-color: #dc3545; border-radius: 5px;">
                                <p style="margin: 0; color: white; font-size: 20px; font-weight: bold;">
                                    Total Outstanding Amount: Rs. ${overallRemainingAmount}
                                </p>
                            </div>
                            
                            <p style="margin: 15px 0 0 0; color: #856404; font-size: 14px;">
                                This amount represents the total outstanding balance across all your bills.
                            </p>
                        </div>
                        
                        <!-- Personalized Message -->
                        <div style="background-color: #f8d7da; padding: 15px; border-radius: 5px; margin: 15px 0;">
                            <p style="margin: 0; color: #721c24; font-size: 16px;">
                                Dear <strong>${customer.customerName}</strong>,
                            </p>
                            <p style="margin: 10px 0; color: #721c24;">
                                Your total outstanding amount is <strong style="color: #dc3545;">Rs. ${overallRemainingAmount}</strong>.
                            </p>
                            <p style="margin: 0; color: #721c24;">
                                Please clear your dues at your earliest convenience.
                            </p>
                        </div>
                    </div>
                    
                    <div style="margin-top: 20px; padding: 15px; background-color: #d4edda; border-radius: 5px;">
                        <p style="margin: 0; color: #155724;">
                            <strong>Thank you for your business!</strong> We appreciate your prompt attention to this matter.
                        </p>
                    </div>
                    
                    <p style="color: #6c757d; font-size: 12px; margin-top: 20px;">
                        This is an automated notification from your billing system.
                    </p>
                </div>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`Notification email sent for ${customer.customerName} - Overall Remaining Amount: Rs. ${overallRemainingAmount}`);
        return info;
        
    } catch (error) {
        console.error(`Failed to send email for ${customer.customerName}:`, error);
        throw error;
    }
}

export { addCustomer, showCustomer,sendNotificationbyDay};