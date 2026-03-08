const axios = require('axios');

// This script requires a valid JWT token to run.
// usage: node test-profile-update.js <token>
const token = process.argv[2];

if (!token) {
  console.log('Please provide a JWT token: node test-profile-update.js <token>');
  process.exit(1);
}

const api = axios.create({
  baseURL: 'http://localhost:5000/api',
  headers: {
    Authorization: `Bearer ${token}`
  }
});

async function runTest() {
  try {
    console.log('Fetching current profile...');
    const { data: initialProfile } = await api.get('/users/profile');
    console.log('Current Profile:', initialProfile.name, initialProfile.email);

    const newName = initialProfile.name.includes('(Updated)') ? initialProfile.name.replace(' (Updated)', '') : initialProfile.name + ' (Updated)';
    
    console.log(`\nUpdating profile name to: ${newName}`);
    const { data: updatedProfile } = await api.put('/users/profile', { name: newName });
    
    console.log('Full Update Response:', updatedProfile);

    if (updatedProfile.name === newName) {
      console.log('\nSUCCESS: Profile name updated successfully!');
    } else {
      console.log('\nFAILURE: Profile name not updated correctly.');
    }

  } catch (error) {
    console.error('\nERROR during test:', error.response?.data?.message || error.message);
  }
}

runTest();
