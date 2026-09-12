import type { Dimensions, EntryStatus } from "@/lib/types";

export type Seed = { slug: string; daysAgo: number; status?: EntryStatus; score?: number; dims?: Dimensions; note?: string; resurface?: "still_hits" | "doesnt_hit" | "not_revisited" };

// A private library over ~20 months. The notes are the point: they are what the engines read.
export const SEEDS: Seed[] = [
  // Spring–summer last year: a warm, restless stretch
  { slug: "movie-paddington-2", daysAgo: 600, score: 9, dims: { comforted_me: true, would_return: true }, note: "Watched it with a cold and a blanket and felt looked after. Warm, silly, generous. I want to be the kind of person Paddington thinks I am." },
  { slug: "tv-ted-lasso", daysAgo: 585, score: 8, dims: { comforted_me: true }, note: "Earnest to the point of embarrassment and I did not care. Comfort food." },
  { slug: "song-wide-open-spaces", daysAgo: 570, score: 8, dims: { would_return: true }, note: "Driving song. The freedom of it, the leaving home of it. I turned it up too loud." },
  { slug: "book-the-hobbit", daysAgo: 560, score: 8, dims: { comforted_me: true, would_return: true }, note: "Reread. Home and hearth and the pull of the road. Cozy, a little wistful." },
  { slug: "anime-spy-x-family", daysAgo: 540, score: 7, dims: { comforted_me: true }, note: "Ridiculous and warm. Found family in a trench coat." },
  { slug: "song-heroes", daysAgo: 530, score: 9, dims: { moved_me: true, would_return: true }, note: "Just for one day. Euphoric and doomed at the same time, which is the feeling I keep chasing." },
  { slug: "movie-mad-max-fury-road", daysAgo: 515, score: 9, dims: { challenged_me: true }, note: "Relentless. Two hours of pure kinetic energy and somehow it is about survival and dignity. Breathless." },
  { slug: "anime-haikyuu", daysAgo: 500, score: 8, dims: { would_return: true }, note: "Pure joy. Friendship as a form of energy. I cried at a volleyball serve." },

  // Autumn: the quiet, aching things start
  { slug: "movie-in-the-mood-for-love", daysAgo: 470, score: 10, dims: { moved_me: true, stuck_with_me: true, would_return: true }, note: "Two people not touching for ninety minutes and it is the most romantic thing I have ever seen. Slow, lush, quiet. The longing lingers for days.", resurface: "still_hits" },
  { slug: "song-both-sides-now", daysAgo: 455, score: 9, dims: { moved_me: true, stuck_with_me: true }, note: "The Joni version from 2000, the older voice. Time and memory and how little we really know. Wistful in a way that feels wise rather than sad." },
  { slug: "book-the-remains-of-the-day", daysAgo: 268, score: 10, dims: { moved_me: true, stuck_with_me: true, changed_perspective: true }, note: "A whole life of not saying the thing. So quiet and restrained that when the ache finally arrives it is unbearable. Stayed with me for weeks." },
  { slug: "movie-past-lives", daysAgo: 420, score: 9, dims: { moved_me: true, stuck_with_me: true }, note: "The bar scene. Two languages, two lives, one goodbye. Bittersweet and gentle and it wrecked me quietly." },
  { slug: "tv-normal-people", daysAgo: 405, score: 8, dims: { moved_me: true }, note: "Intimate to the point of discomfort. Two people who cannot say what they mean. Ached the whole way through." },
  { slug: "song-the-night-we-met", daysAgo: 395, score: 8, dims: { stuck_with_me: true }, note: "Memory as a haunting. I had to sit in the car until it finished." },

  // Winter: grief
  { slug: "movie-aftersun", daysAgo: 360, score: 10, dims: { moved_me: true, stuck_with_me: true, changed_perspective: true }, note: "Quiet devastation. A father and daughter on a cheap holiday and the memory of it years later. Nothing happens and then everything does. I sat in the dark for a long time after.", resurface: "still_hits" },
  { slug: "book-crying-in-h-mart", daysAgo: 345, score: 9, dims: { moved_me: true, stuck_with_me: true }, note: "Grief and food and a mother. Tender and honest and it made me call home. The loss lingers in the kitchen." },
  { slug: "tv-the-leftovers", daysAgo: 330, score: 9, dims: { moved_me: true, challenged_me: true }, note: "Grief as a weather system. Unbearable and beautiful. Faith without answers. Devastated me in a way I did not expect from television." },
  { slug: "song-motion-picture-soundtrack", daysAgo: 322, score: 9, dims: { stuck_with_me: true }, note: "The harp and the organ and that hazy, drowned voice. Death as a slow fade. Haunting." },
  { slug: "book-the-year-of-magical-thinking", daysAgo: 310, score: 8, dims: { challenged_me: true, changed_perspective: true }, note: "Spare, cold, precise about grief in a way that felt like being handed a map. Didion refuses comfort and that was the comfort." },
  { slug: "anime-frieren", daysAgo: 300, score: 9, dims: { moved_me: true, stuck_with_me: true }, note: "An elf outliving everyone she loved and only understanding it afterwards. Time and memory and regret, so gently. Wistful in the best way." },

  // Spring: the Bon Iver album, and Ishiguro
  { slug: "song-re-stacks", daysAgo: 260, score: 9, dims: { moved_me: true, would_return: true }, note: "Just a voice and a guitar in a cabin. Spare and raw and lonely. Everything is stacked up and it is all fine." },
  { slug: "song-skinny-love", daysAgo: 255, score: 8, dims: { moved_me: true }, note: "Raw, cracked, intimate. Love that is not enough." },
  { slug: "song-flume", daysAgo: 248, score: 8, dims: { stuck_with_me: true }, note: "The whole album is one long winter. This one is the loneliest." },
  { slug: "book-never-let-me-go", daysAgo: 235, score: 9, dims: { moved_me: true, stuck_with_me: true }, note: "The quietest dystopia. Memory told by someone who cannot quite say what was taken from her. Devastating without raising its voice." },
  { slug: "book-klara-and-the-sun", daysAgo: 215, score: 8, dims: { moved_me: true }, note: "Faith and love from something that was never meant to have either. Tender, quiet, a little heartbreaking." },
  { slug: "movie-moonlight", daysAgo: 200, score: 9, dims: { moved_me: true, stuck_with_me: true }, note: "Three chapters of a boy becoming a man and learning who he is. Tender and quiet and blue. The diner scene." },

  // Summer: sharper, wry, a little cold
  { slug: "tv-succession", daysAgo: 150, score: 9, dims: { challenged_me: true }, note: "Cold and wry and cruel and very funny. Power as a family disease. Shakespearean in a boardroom." },
  { slug: "movie-the-social-network", daysAgo: 140, score: 8, dims: { changed_perspective: true }, note: "Precise and cold and fast. Loneliness at scale. Polished like a blade." },
  { slug: "book-the-catcher-in-the-rye", daysAgo: 125, score: 6, dims: {}, note: "Reread as an adult. Wry, restless, lonely. I was less patient with him this time.", resurface: "doesnt_hit" },
  { slug: "song-motion-sickness", daysAgo: 115, score: 8, dims: { stuck_with_me: true }, note: "Deadpan and confessional. Sad in a way that is also funny about being sad." },
  { slug: "tv-fleabag", daysAgo: 100, score: 10, dims: { moved_me: true, changed_perspective: true, stuck_with_me: true }, note: "Confessional, wry, grieving. The priest season. Cathartic in a way that felt like being seen. It will pass." },
  { slug: "anime-monster", daysAgo: 80, status: "in_progress", dims: {}, note: "Slow, cerebral, eerie. Dread that builds by the episode." },
  { slug: "tv-severance", daysAgo: 60, score: 8, dims: { challenged_me: true }, note: "Austere and eerie. Identity split down the middle. Unsettling in a very polished way." },
  { slug: "movie-everything-everywhere", daysAgo: 30, score: 8, dims: { moved_me: true }, note: "Chaotic and then suddenly so tender about mothers and daughters. Cathartic. The rocks." },
  { slug: "song-holocene", daysAgo: 12, score: 9, dims: { moved_me: true, would_return: true }, note: "And at once I knew I was not magnificent. Serene and vast and a little lonely. I put it on at night." },

  // Backlog
  { slug: "book-piranesi", daysAgo: 90, status: "want" },
  { slug: "anime-mushishi", daysAgo: 70, status: "want" },
  { slug: "song-blue-in-green", daysAgo: 45, status: "want" },
  { slug: "movie-portrait-of-a-lady-on-fire", daysAgo: 40, status: "want" },
  { slug: "tv-station-eleven", daysAgo: 20, status: "want" },
  { slug: "book-piranesi", daysAgo: 90, status: "want" },
];

