import { dbService } from './DatabaseService';
import { Media, MediaHistory, Wishlist, LocalFile, Availability } from '../types/media';

export function seedDatabaseIfEmpty(): void {
  const existingMedia = dbService.getAllMedia();
  if (existingMedia.length > 0) {
    return; // Already seeded
  }

  const now = new Date().toISOString();

  // 1. Aanandam
  const aanandam: Media = {
    id: 'media_aanandam',
    type: 'Film',
    title: 'Aanandam',
    release_year: 2016,
    language: 'Malayalam',
    description: 'A group of engineering students go on their first college road trip across India, forming lifelong bonds, romantic feelings, and personal discoveries along the way.',
    genres: ['Comedy', 'Drama', 'Romance'],
    runtime: 140,
    poster: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&w=600&q=80',
    backdrop: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1600&q=80',
    metadata_source: 'Initial Seed',
    created_at: '2026-09-03T10:00:00Z',
    updated_at: now,
    external_ids: [
      { id: 'ext_1', media_id: 'media_aanandam', provider: 'TMDB', external_id: '423101' }
    ]
  };

  const aanandamHistory: MediaHistory = {
    id: 'hist_aanandam_1',
    media_id: 'media_aanandam',
    completed_at: '2026-09-03',
    status: 'Finished',
    score: 4,
    thoughts: 'Heartwarming watch. Classic college trip nostalgia!',
    context: '2+ Rewatch',
    source: 'Notion',
    created_at: '2026-09-03T10:00:00Z'
  };

  // 2. Premalu
  const premalu: Media = {
    id: 'media_premalu',
    type: 'Film',
    title: 'Premalu',
    release_year: 2024,
    language: 'Malayalam',
    description: 'Sachin pursues romance in Hyderabad, leading to funny and heartwarming situations between friends and colleagues.',
    genres: ['Comedy', 'Romance'],
    runtime: 156,
    poster: 'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=600&q=80',
    backdrop: 'https://images.unsplash.com/photo-1518173946687-a4c8a383392e?auto=format&fit=crop&w=1600&q=80',
    metadata_source: 'Initial Seed',
    created_at: '2026-09-03T11:00:00Z',
    updated_at: now
  };

  const premaluHistory: MediaHistory = {
    id: 'hist_premalu_1',
    media_id: 'media_premalu',
    completed_at: '2026-09-03',
    status: 'Finished',
    score: 4,
    thoughts: 'So funny! Great humor and timing throughout.',
    context: 'Rewatch',
    source: 'Notion',
    created_at: '2026-09-03T11:00:00Z'
  };

  // 3. Overcooked
  const overcooked: Media = {
    id: 'media_overcooked',
    type: 'VideoGame',
    title: 'Overcooked',
    release_year: 2016,
    language: 'English',
    description: 'A chaotic couch co-op cooking game where 1 to 4 players prepare meals in absurd, rapidly changing kitchen setups.',
    genres: ['Co-op', 'Party', 'Simulation'],
    publisher: 'Team17',
    poster: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=600&q=80',
    backdrop: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1600&q=80',
    metadata_source: 'Initial Seed',
    created_at: '2026-08-23T12:00:00Z',
    updated_at: now
  };

  const overcookedHistory: MediaHistory = {
    id: 'hist_overcooked_1',
    media_id: 'media_overcooked',
    started_at: '2026-08-23',
    status: 'Abandoned',
    score: 4,
    thoughts: 'Too intense with friends late night, abandoned for now.',
    context: 'restart',
    source: 'Notion',
    created_at: '2026-08-23T12:00:00Z'
  };

  // 4. Assassin's Creed IV: Black Flag (Demonstrating MULTIPLE histories!)
  const ac4: Media = {
    id: 'media_ac4',
    type: 'VideoGame',
    title: "Assassin's Creed IV: Black Flag",
    release_year: 2013,
    language: 'English',
    description: 'Set during the Golden Age of Piracy, play as Edward Kenway, a piratical Assassin navigating naval combat and West Indies exploration.',
    genres: ['Action', 'Adventure', 'Open World'],
    publisher: 'Ubisoft',
    poster: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=600&q=80',
    backdrop: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=1600&q=80',
    metadata_source: 'Initial Seed',
    created_at: '2026-08-22T14:00:00Z',
    updated_at: now,
    external_ids: [
      { id: 'ext_ac4_1', media_id: 'media_ac4', provider: 'Steam', external_id: '242050' },
      { id: 'ext_ac4_2', media_id: 'media_ac4', provider: 'IGDB', external_id: '1877' }
    ]
  };

  // First session: August 22 — Abandoned
  const ac4History1: MediaHistory = {
    id: 'hist_ac4_1',
    media_id: 'media_ac4',
    started_at: '2026-08-22',
    status: 'Abandoned',
    score: 4,
    thoughts: 'Save sync glitched on first run.',
    context: 'initial play',
    source: 'Notion',
    created_at: '2026-08-22T14:00:00Z'
  };

  // Second session: August 23 — Resynced / Currently playing
  const ac4History2: MediaHistory = {
    id: 'hist_ac4_2',
    media_id: 'media_ac4',
    started_at: '2026-08-23',
    status: 'Currently',
    score: 4,
    thoughts: 'Resynced cloud save and loving the naval battles!',
    context: 'resynced',
    source: 'Notion',
    created_at: '2026-08-23T15:00:00Z'
  };

  // 5. The Paper
  const thePaper: Media = {
    id: 'media_the_paper',
    type: 'TV Series',
    title: 'The Paper',
    release_year: 2021,
    language: 'English',
    description: 'Inside a newspaper office struggling to maintain journalistic integrity amid political shifts and changing media landscapes.',
    genres: ['Drama', 'Thriller'],
    poster: 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=600&q=80',
    backdrop: 'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?auto=format&fit=crop&w=1600&q=80',
    metadata_source: 'Initial Seed',
    created_at: '2026-09-26T10:00:00Z',
    updated_at: now
  };

  const thePaperHistory: MediaHistory = {
    id: 'hist_the_paper_1',
    media_id: 'media_the_paper',
    started_at: '2026-09-26',
    completed_at: '2026-10-04',
    status: 'Finished',
    score: 4,
    thoughts: 'Season 2 was intense and high stakes.',
    context: 'Season 2',
    source: 'Notion',
    created_at: '2026-10-04T20:00:00Z'
  };

  // 6. Ted Lasso
  const tedLasso: Media = {
    id: 'media_ted_lasso',
    type: 'TV Series',
    title: 'Ted Lasso',
    release_year: 2020,
    language: 'English',
    description: 'An American college football coach is hired to manage a British soccer team. What he lacks in knowledge, he makes up for with optimism.',
    genres: ['Comedy', 'Drama', 'Sport'],
    publisher: 'Apple TV+',
    poster: 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=600&q=80',
    backdrop: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=1600&q=80',
    metadata_source: 'Initial Seed',
    created_at: '2026-08-16T09:00:00Z',
    updated_at: now
  };

  const tedLassoHistory: MediaHistory = {
    id: 'hist_ted_lasso_1',
    media_id: 'media_ted_lasso',
    started_at: '2026-08-16',
    status: 'Currently',
    score: 4,
    thoughts: 'Rewatched Seasons 1 & 2 before starting S3/4!',
    context: 'Season 1-2 rewatch, 3-4',
    source: 'Notion',
    created_at: '2026-08-16T09:00:00Z'
  };

  // 7. Song of Farca
  const songOfFarca: Media = {
    id: 'media_farca',
    type: 'VideoGame',
    title: 'Song of Farca',
    release_year: 2021,
    language: 'English',
    description: 'Play as Isabella Song, a cyber-detective investigating crimes in a dystopian city using hacking, drone surveillance, and deduction.',
    genres: ['Detective', 'Cyberpunk', 'Puzzle'],
    publisher: 'TinyBuild',
    poster: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=600&q=80',
    backdrop: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1600&q=80',
    metadata_source: 'Initial Seed',
    created_at: '2026-07-10T12:00:00Z',
    updated_at: now
  };

  const songOfFarcaHistory: MediaHistory = {
    id: 'hist_farca_1',
    media_id: 'media_farca',
    completed_at: '2026-07-15',
    status: 'Finished',
    score: 5,
    thoughts: 'Unique hacker investigative vibe. Great story choices.',
    source: 'Notion',
    created_at: '2026-07-15T18:00:00Z'
  };

  // 8. The Last of Us Part II
  const tlou2: Media = {
    id: 'media_tlou2',
    type: 'VideoGame',
    title: 'The Last of Us Part II',
    release_year: 2020,
    language: 'English',
    description: 'Five years after their dangerous journey across the post-pandemic United States, Ellie and Joel have settled down in Jackson, Wyoming.',
    genres: ['Action', 'Adventure', 'Survival Horror'],
    publisher: 'Sony Interactive Entertainment',
    poster: 'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?auto=format&fit=crop&w=600&q=80',
    backdrop: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=1600&q=80',
    metadata_source: 'Initial Seed',
    created_at: '2026-06-01T10:00:00Z',
    updated_at: now
  };

  const tlou2History: MediaHistory = {
    id: 'hist_tlou2_1',
    media_id: 'media_tlou2',
    completed_at: '2026-06-20',
    status: 'Finished',
    score: 5,
    thoughts: 'Masterpiece in storytelling and visual fidelity.',
    source: 'Notion',
    created_at: '2026-06-20T21:00:00Z'
  };

  // Save all media and history
  const allSeedMedia = [aanandam, premalu, overcooked, ac4, thePaper, tedLasso, songOfFarca, tlou2];
  const allSeedHistory = [
    aanandamHistory,
    premaluHistory,
    overcookedHistory,
    ac4History1,
    ac4History2,
    thePaperHistory,
    tedLassoHistory,
    songOfFarcaHistory,
    tlou2History
  ];

  for (const m of allSeedMedia) {
    dbService.saveMedia(m);
  }
  for (const h of allSeedHistory) {
    dbService.saveHistory(h);
  }

  // Seed sample LocalFiles
  const sampleLocalFiles: LocalFile[] = [
    {
      id: 'lf_ac4_1',
      media_id: 'media_ac4',
      path: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Assassins Creed IV Black Flag\\AC4BFSP.exe',
      filename: 'AC4BFSP.exe',
      extension: 'exe',
      size: 45200000000,
      discovered_at: now,
      last_seen_at: now,
      exists: true,
      file_type: 'game_executable',
      launch_info: 'steam://rungameid/242050'
    },
    {
      id: 'lf_aanandam_1',
      media_id: 'media_aanandam',
      path: 'D:\\Movies\\Malayalam\\Aanandam (2016) [1080p].mkv',
      filename: 'Aanandam (2016) [1080p].mkv',
      extension: 'mkv',
      size: 3200000000,
      discovered_at: now,
      last_seen_at: now,
      exists: true,
      file_type: 'movie'
    }
  ];
  for (const lf of sampleLocalFiles) {
    dbService.saveLocalFile(lf);
  }

  // Seed sample Availability
  const sampleAvailabilities: Availability[] = [
    {
      id: 'avail_1',
      media_id: 'media_ted_lasso',
      provider: 'Apple TV+',
      country: 'US',
      availability_type: 'Stream',
      url: 'https://tv.apple.com/us/show/ted-lasso/umc.cmc.v09p0ip92hs328cfndowq9z8',
      last_checked: now
    },
    {
      id: 'avail_2',
      media_id: 'media_premalu',
      provider: 'Disney+ Hotstar',
      country: 'IN',
      availability_type: 'Stream',
      url: 'https://www.hotstar.com',
      last_checked: now
    }
  ];
  for (const av of sampleAvailabilities) {
    dbService.saveAvailability(av);
  }

  // Seed sample Wishlist
  const sampleWishlist: Wishlist[] = [
    {
      id: 'wish_1',
      title: 'Dune: Part Two',
      type: 'Film',
      source: 'Google Wishlist',
      notes: 'Want to watch on IMAX setup',
      added_at: '2026-08-01T00:00:00Z',
      poster: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=600&q=80'
    },
    {
      id: 'wish_2',
      title: 'Hades II',
      type: 'VideoGame',
      source: 'Notion Wishlist',
      notes: 'Supergiant Games rogue-like sequel',
      added_at: '2026-08-10T00:00:00Z',
      poster: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=600&q=80'
    }
  ];
  for (const w of sampleWishlist) {
    dbService.saveWishlist(w);
  }

  // Save initial settings
  dbService.saveSetting('movies_folder', 'C:\\Media\\Movies');
  dbService.saveSetting('tv_folder', 'C:\\Media\\TV Shows');
  dbService.saveSetting('games_folder', 'D:\\Games');
  dbService.saveSetting('country_region', 'United States');
}
