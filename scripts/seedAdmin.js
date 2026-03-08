const User = require('../models/User');

const seedAdmin = async () => {
    try {
        const adminEmail = 'malik.umerkhan97@gmail.com';
        const adminPassword = 'malikawan97';

        const adminExists = await User.findOne({ email: adminEmail });

        if (!adminExists) {
            await User.create({
                name: 'SuperAdmin',
                email: adminEmail,
                password: adminPassword,
                role: 'admin',
                // Password hashing is handled by User model pre-save hook
            });
            console.log('Admin user created successfully');
        } else {
            console.log('Admin user already exists');
        }
    } catch (error) {
        console.error('Error seeding admin user:', error);
    }
};

module.exports = seedAdmin;
