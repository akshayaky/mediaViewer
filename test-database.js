// Test script to view database entries
import {dbService} from './src/services/DatabaseService.ts';

async function printDatabase() {
  console.log('='.repeat(60));
  console.log('📊 MEDIA COLLECTION'.toUpperCase());
  console.log('='.repeat(60));
  
  const db = await dbService.init();
  
  // View all media entries
  const mediaList = dbService.getAllMedia();
  console.log(`\nTotal Media Entries: ${mediaList.length}`);
  console.log('\n--- Media List ---');
  mediaList.forEach(m => {
    console.log(`• [${m.type}] ${m.title} (${m.release_year || 'N/A'}) - Source: ${m.metadata_source || 'Unknown'}`);
  });
  
  // View history
  const history = dbService.getAllHistory();
  console.log(`\nTotal History Entries: ${history.length}`);
  
  // View local files
  const localFiles = dbService.getAllLocalFiles();
  console.log(`\nTotal Local File Paths: ${localFiles.length}`);
}

printDatabase().catch(console.error);
