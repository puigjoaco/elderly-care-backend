// Script de prueba de conexión
const { Client } = require('pg');

// Probar diferentes configuraciones
const configs = [
  {
    name: 'Config 1: Con variables de entorno',
    connectionString: 'postgresql://postgres:postgres123@localhost:5432/elderly_care'
  },
  {
    name: 'Config 2: Con host docker',
    host: 'host.docker.internal',
    port: 5432,
    database: 'elderly_care',
    user: 'postgres',
    password: 'postgres123'
  },
  {
    name: 'Config 3: Con 127.0.0.1',
    host: '127.0.0.1',
    port: 5432,
    database: 'elderly_care',
    user: 'postgres',
    password: 'postgres123'
  }
];

async function testConnection(config) {
  console.log(`\nProbando: ${config.name}`);
  const client = new Client(config.connectionString ? { connectionString: config.connectionString } : config);
  
  try {
    await client.connect();
    console.log('✅ Conexión exitosa!');
    const result = await client.query('SELECT COUNT(*) FROM patients');
    console.log(`   Pacientes en la base de datos: ${result.rows[0].count}`);
    await client.end();
  } catch (err) {
    console.log('❌ Error de conexión:', err.message);
  }
}

async function runTests() {
  for (const config of configs) {
    await testConnection(config);
  }
}

runTests();