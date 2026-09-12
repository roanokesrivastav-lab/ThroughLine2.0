// Hand-written canon: titles many people have encountered, spread across the five
// categories. `encounter` is a rough guess at how likely someone is to have met the
// title (used ONLY to order onboarding cards; never displayed, never a quality signal).
// `feel` is a faint prior in the shared vocabulary so an early "Loved it" tap already
// says something. Metadata numbers are approximate.

import type { Category } from "@/lib/types";

export type CanonItem = {
  slug: string;
  category: Category;
  title: string;
  subtitle: string;      // director / creator / author / artist
  year: number;
  genres: string[];
  meta: { runtime_minutes?: number; episode_runtime_minutes?: number; episodes?: number; pages?: number; duration_seconds?: number; album?: string };
  encounter: number;     // 0..1
  feel: Array<[string, number]>;
};

const M = (slug: string, title: string, subtitle: string, year: number, genres: string[], runtime: number, encounter: number, feel: Array<[string, number]>): CanonItem =>
  ({ slug, category: "movie", title, subtitle, year, genres, meta: { runtime_minutes: runtime }, encounter, feel });
const T = (slug: string, title: string, subtitle: string, year: number, genres: string[], ep: number, episodes: number, encounter: number, feel: Array<[string, number]>): CanonItem =>
  ({ slug, category: "tv", title, subtitle, year, genres, meta: { episode_runtime_minutes: ep, episodes }, encounter, feel });
const A = (slug: string, title: string, subtitle: string, year: number, genres: string[], ep: number, episodes: number, encounter: number, feel: Array<[string, number]>): CanonItem =>
  ({ slug, category: "anime", title, subtitle, year, genres, meta: ep >= 60 ? { runtime_minutes: ep } : { episode_runtime_minutes: ep, episodes }, encounter, feel });
const B = (slug: string, title: string, subtitle: string, year: number, genres: string[], pages: number, encounter: number, feel: Array<[string, number]>): CanonItem =>
  ({ slug, category: "book", title, subtitle, year, genres, meta: { pages }, encounter, feel });
const S = (slug: string, title: string, subtitle: string, year: number, genres: string[], seconds: number, album: string, encounter: number, feel: Array<[string, number]>): CanonItem =>
  ({ slug, category: "music", title, subtitle, year, genres, meta: { duration_seconds: seconds, album }, encounter, feel });

export const CANON: CanonItem[] = [
  // ---- Films ----
  M("movie-spirited-away", "Spirited Away", "Hayao Miyazaki", 2001, ["animation", "fantasy", "family"], 125, 0.9, [["theme.wonder", 0.8], ["theme.growing-up", 0.7], ["tone.lush", 0.6], ["texture.dreamlike", 0.7], ["aftertaste.hopeful", 0.5]]),
  M("movie-eternal-sunshine", "Eternal Sunshine of the Spotless Mind", "Michel Gondry", 2004, ["romance", "sci-fi", "drama"], 108, 0.8, [["theme.memory", 0.9], ["theme.love", 0.8], ["ache", 0.8], ["aftertaste.bittersweet", 0.9], ["texture.dreamlike", 0.6]]),
  M("movie-the-godfather", "The Godfather", "Francis Ford Coppola", 1972, ["crime", "drama"], 175, 0.95, [["theme.family", 0.9], ["theme.power", 0.9], ["register.epic", 0.7], ["tone.austere", 0.5], ["pace", 0.3]]),
  M("movie-parasite", "Parasite", "Bong Joon-ho", 2019, ["thriller", "drama", "comedy"], 132, 0.9, [["theme.class", 0.95], ["tone.wry", 0.6], ["aftertaste.unsettling", 0.8], ["intensity", 0.75]]),
  M("movie-in-the-mood-for-love", "In the Mood for Love", "Wong Kar-wai", 2000, ["romance", "drama"], 98, 0.55, [["theme.desire", 0.8], ["ache", 0.9], ["tone.lush", 0.8], ["register.quiet", 0.8], ["pace", 0.15], ["aftertaste.lingering", 0.9]]),
  M("movie-before-sunrise", "Before Sunrise", "Richard Linklater", 1995, ["romance", "drama"], 101, 0.7, [["theme.love", 0.85], ["register.intimate", 0.9], ["tone.romantic", 0.8], ["aftertaste.bittersweet", 0.6], ["texture.spare", 0.5]]),
  M("movie-moonlight", "Moonlight", "Barry Jenkins", 2016, ["drama"], 111, 0.75, [["theme.identity", 0.9], ["theme.growing-up", 0.8], ["tone.tender", 0.9], ["register.quiet", 0.7], ["ache", 0.8]]),
  M("movie-the-dark-knight", "The Dark Knight", "Christopher Nolan", 2008, ["action", "crime", "thriller"], 152, 0.95, [["theme.justice", 0.8], ["theme.madness", 0.6], ["intensity", 0.9], ["register.propulsive", 0.8], ["tone.bleak", 0.5]]),
  M("movie-lost-in-translation", "Lost in Translation", "Sofia Coppola", 2003, ["drama", "romance"], 102, 0.75, [["theme.loneliness", 0.9], ["register.quiet", 0.8], ["tone.wistful", 0.8], ["texture.hazy", 0.6], ["aftertaste.lingering", 0.7]]),
  M("movie-mad-max-fury-road", "Mad Max: Fury Road", "George Miller", 2015, ["action", "sci-fi"], 120, 0.85, [["register.propulsive", 0.95], ["intensity", 0.95], ["pace", 0.95], ["theme.survival", 0.8], ["aftertaste.energized", 0.9]]),
  M("movie-the-shawshank-redemption", "The Shawshank Redemption", "Frank Darabont", 1994, ["drama"], 142, 0.95, [["theme.freedom", 0.9], ["theme.friendship", 0.8], ["aftertaste.hopeful", 0.9], ["tone.earnest", 0.7]]),
  M("movie-pulp-fiction", "Pulp Fiction", "Quentin Tarantino", 1994, ["crime", "comedy"], 154, 0.9, [["tone.wry", 0.8], ["tone.playful", 0.7], ["theme.violence", 0.7], ["register.propulsive", 0.6], ["aftertaste.energized", 0.7]]),
  M("movie-her", "Her", "Spike Jonze", 2013, ["romance", "sci-fi", "drama"], 126, 0.75, [["theme.loneliness", 0.9], ["theme.love", 0.8], ["tone.tender", 0.8], ["texture.polished", 0.5], ["aftertaste.bittersweet", 0.8]]),
  M("movie-inception", "Inception", "Christopher Nolan", 2010, ["sci-fi", "action", "thriller"], 148, 0.95, [["register.cerebral", 0.8], ["texture.dense", 0.8], ["theme.memory", 0.6], ["intensity", 0.8], ["pace", 0.8]]),
  M("movie-paddington-2", "Paddington 2", "Paul King", 2017, ["family", "comedy", "adventure"], 103, 0.7, [["tone.warm", 0.95], ["tone.playful", 0.8], ["aftertaste.comforting", 0.9], ["theme.friendship", 0.7], ["aftertaste.hopeful", 0.8]]),
  M("movie-hereditary", "Hereditary", "Ari Aster", 2018, ["horror", "drama"], 127, 0.7, [["theme.grief", 0.9], ["theme.family", 0.8], ["tone.eerie", 0.9], ["aftertaste.unsettling", 0.95], ["intensity", 0.9]]),
  M("movie-la-la-land", "La La Land", "Damien Chazelle", 2016, ["romance", "music", "drama"], 128, 0.85, [["theme.art", 0.8], ["theme.love", 0.8], ["tone.romantic", 0.8], ["aftertaste.bittersweet", 0.9], ["tone.lush", 0.6]]),
  M("movie-everything-everywhere", "Everything Everywhere All at Once", "Daniel Kwan & Daniel Scheinert", 2022, ["sci-fi", "comedy", "drama"], 139, 0.8, [["theme.family", 0.9], ["tone.playful", 0.8], ["intensity", 0.9], ["aftertaste.cathartic", 0.9], ["texture.dense", 0.7]]),
  M("movie-portrait-of-a-lady-on-fire", "Portrait of a Lady on Fire", "Céline Sciamma", 2019, ["romance", "drama"], 122, 0.5, [["theme.desire", 0.9], ["theme.art", 0.7], ["register.quiet", 0.85], ["pace", 0.2], ["ache", 0.9], ["aftertaste.lingering", 0.9]]),
  M("movie-no-country-for-old-men", "No Country for Old Men", "Joel & Ethan Coen", 2007, ["thriller", "crime", "western"], 122, 0.8, [["tone.bleak", 0.8], ["tone.austere", 0.8], ["theme.violence", 0.8], ["texture.spare", 0.8], ["aftertaste.unsettling", 0.7]]),
  M("movie-aftersun", "Aftersun", "Charlotte Wells", 2022, ["drama"], 102, 0.45, [["theme.memory", 0.95], ["theme.family", 0.8], ["ache", 0.95], ["register.quiet", 0.9], ["texture.hazy", 0.7], ["aftertaste.devastating", 0.8]]),
  M("movie-the-social-network", "The Social Network", "David Fincher", 2010, ["drama"], 120, 0.8, [["register.cerebral", 0.8], ["tone.cold", 0.7], ["theme.loneliness", 0.6], ["theme.power", 0.6], ["texture.polished", 0.8], ["pace", 0.8]]),
  M("movie-amelie", "Amélie", "Jean-Pierre Jeunet", 2001, ["romance", "comedy"], 122, 0.8, [["tone.playful", 0.9], ["tone.warm", 0.8], ["texture.ornate", 0.7], ["theme.loneliness", 0.5], ["aftertaste.comforting", 0.7]]),
  M("movie-past-lives", "Past Lives", "Celine Song", 2023, ["romance", "drama"], 105, 0.5, [["theme.time", 0.9], ["theme.love", 0.8], ["ache", 0.9], ["register.quiet", 0.8], ["aftertaste.bittersweet", 0.95]]),

  // ---- TV ----
  T("tv-breaking-bad", "Breaking Bad", "Vince Gilligan", 2008, ["crime", "drama", "thriller"], 47, 62, 0.95, [["theme.power", 0.9], ["theme.family", 0.6], ["intensity", 0.9], ["tone.bleak", 0.6], ["register.propulsive", 0.7]]),
  T("tv-the-office-us", "The Office", "Greg Daniels", 2005, ["comedy"], 22, 201, 0.95, [["tone.warm", 0.8], ["tone.playful", 0.9], ["aftertaste.comforting", 0.95], ["theme.friendship", 0.7]]),
  T("tv-fleabag", "Fleabag", "Phoebe Waller-Bridge", 2016, ["comedy", "drama"], 27, 12, 0.75, [["register.confessional", 0.95], ["tone.wry", 0.9], ["theme.grief", 0.8], ["ache", 0.8], ["aftertaste.cathartic", 0.8]]),
  T("tv-the-bear", "The Bear", "Christopher Storer", 2022, ["drama", "comedy"], 32, 38, 0.75, [["intensity", 0.9], ["theme.family", 0.8], ["theme.grief", 0.7], ["register.loud", 0.7], ["texture.raw", 0.8], ["pace", 0.85]]),
  T("tv-succession", "Succession", "Jesse Armstrong", 2018, ["drama"], 60, 39, 0.8, [["theme.power", 0.95], ["theme.family", 0.9], ["tone.wry", 0.8], ["tone.cold", 0.6], ["register.cerebral", 0.6]]),
  T("tv-the-sopranos", "The Sopranos", "David Chase", 1999, ["crime", "drama"], 55, 86, 0.85, [["theme.family", 0.9], ["theme.madness", 0.5], ["tone.wry", 0.6], ["texture.dense", 0.7], ["aftertaste.unsettling", 0.6]]),
  T("tv-severance", "Severance", "Dan Erickson", 2022, ["sci-fi", "thriller", "drama"], 50, 19, 0.7, [["theme.identity", 0.9], ["tone.eerie", 0.8], ["tone.austere", 0.7], ["texture.polished", 0.8], ["aftertaste.unsettling", 0.8]]),
  T("tv-mad-men", "Mad Men", "Matthew Weiner", 2007, ["drama"], 47, 92, 0.75, [["theme.identity", 0.8], ["theme.time", 0.7], ["tone.melancholy", 0.7], ["texture.polished", 0.8], ["pace", 0.3]]),
  T("tv-ted-lasso", "Ted Lasso", "Bill Lawrence & Jason Sudeikis", 2020, ["comedy", "drama"], 40, 34, 0.8, [["tone.warm", 0.95], ["tone.earnest", 0.9], ["aftertaste.comforting", 0.9], ["aftertaste.hopeful", 0.9], ["theme.friendship", 0.8]]),
  T("tv-twin-peaks", "Twin Peaks", "David Lynch & Mark Frost", 1990, ["mystery", "drama"], 47, 48, 0.65, [["tone.eerie", 0.95], ["texture.dreamlike", 0.95], ["tone.playful", 0.4], ["aftertaste.haunting", 0.9]]),
  T("tv-the-wire", "The Wire", "David Simon", 2002, ["crime", "drama"], 60, 60, 0.75, [["theme.class", 0.9], ["theme.justice", 0.8], ["texture.dense", 0.9], ["tone.austere", 0.6], ["pace", 0.3]]),
  T("tv-station-eleven", "Station Eleven", "Patrick Somerville", 2021, ["drama", "sci-fi"], 50, 10, 0.4, [["theme.art", 0.9], ["theme.survival", 0.7], ["theme.memory", 0.8], ["tone.tender", 0.8], ["aftertaste.hopeful", 0.8]]),
  T("tv-chernobyl", "Chernobyl", "Craig Mazin", 2019, ["drama", "history"], 65, 5, 0.75, [["tone.bleak", 0.9], ["intensity", 0.9], ["theme.power", 0.7], ["aftertaste.unsettling", 0.9], ["tone.austere", 0.8]]),
  T("tv-normal-people", "Normal People", "Lenny Abrahamson & Hettie Macdonald", 2020, ["romance", "drama"], 30, 12, 0.6, [["theme.love", 0.9], ["theme.growing-up", 0.8], ["register.intimate", 0.95], ["ache", 0.9], ["register.quiet", 0.8]]),
  T("tv-the-leftovers", "The Leftovers", "Damon Lindelof & Tom Perrotta", 2014, ["drama", "mystery"], 55, 28, 0.5, [["theme.grief", 0.95], ["theme.faith", 0.8], ["ache", 0.95], ["aftertaste.devastating", 0.8], ["texture.dense", 0.6]]),
  T("tv-better-call-saul", "Better Call Saul", "Vince Gilligan & Peter Gould", 2015, ["crime", "drama"], 46, 63, 0.75, [["theme.identity", 0.8], ["ache", 0.7], ["pace", 0.3], ["texture.polished", 0.8], ["aftertaste.bittersweet", 0.8]]),
  T("tv-game-of-thrones", "Game of Thrones", "David Benioff & D. B. Weiss", 2011, ["fantasy", "drama"], 57, 73, 0.95, [["register.epic", 0.95], ["theme.power", 0.9], ["theme.violence", 0.8], ["intensity", 0.85]]),
  T("tv-stranger-things", "Stranger Things", "The Duffer Brothers", 2016, ["sci-fi", "horror", "drama"], 51, 42, 0.9, [["theme.friendship", 0.8], ["tone.eerie", 0.7], ["theme.memory", 0.5], ["aftertaste.energized", 0.6], ["tone.warm", 0.5]]),
  T("tv-atlanta", "Atlanta", "Donald Glover", 2016, ["comedy", "drama"], 30, 41, 0.6, [["tone.wry", 0.9], ["texture.dreamlike", 0.7], ["theme.identity", 0.7], ["aftertaste.unsettling", 0.5]]),
  T("tv-derry-girls", "Derry Girls", "Lisa McGee", 2018, ["comedy"], 23, 19, 0.5, [["tone.playful", 0.95], ["tone.warm", 0.8], ["theme.friendship", 0.9], ["theme.growing-up", 0.8], ["aftertaste.comforting", 0.7]]),

  // ---- Anime ----
  A("anime-cowboy-bebop", "Cowboy Bebop", "Shinichirō Watanabe", 1998, ["sci-fi", "action", "noir"], 24, 26, 0.75, [["tone.melancholy", 0.8], ["tone.wry", 0.6], ["theme.loneliness", 0.7], ["theme.memory", 0.7], ["aftertaste.bittersweet", 0.9]]),
  A("anime-neon-genesis-evangelion", "Neon Genesis Evangelion", "Hideaki Anno", 1995, ["sci-fi", "mecha", "drama"], 24, 26, 0.75, [["theme.identity", 0.9], ["theme.loneliness", 0.9], ["theme.madness", 0.7], ["intensity", 0.9], ["aftertaste.unsettling", 0.8]]),
  A("anime-your-name", "Your Name", "Makoto Shinkai", 2016, ["romance", "fantasy", "drama"], 106, 1, 0.8, [["theme.love", 0.9], ["theme.time", 0.8], ["theme.memory", 0.8], ["ache", 0.8], ["tone.lush", 0.9], ["aftertaste.bittersweet", 0.8]]),
  A("anime-fullmetal-alchemist-brotherhood", "Fullmetal Alchemist: Brotherhood", "Yasuhiro Irie", 2009, ["fantasy", "adventure", "action"], 24, 64, 0.8, [["theme.family", 0.9], ["theme.justice", 0.7], ["register.epic", 0.8], ["tone.earnest", 0.8], ["aftertaste.cathartic", 0.8]]),
  A("anime-attack-on-titan", "Attack on Titan", "Tetsurō Araki", 2013, ["action", "drama", "fantasy"], 24, 94, 0.85, [["intensity", 0.95], ["theme.freedom", 0.9], ["theme.violence", 0.9], ["tone.bleak", 0.7], ["register.epic", 0.8]]),
  A("anime-mob-psycho-100", "Mob Psycho 100", "Yuzuru Tachikawa", 2016, ["comedy", "action", "supernatural"], 24, 37, 0.6, [["tone.warm", 0.8], ["tone.playful", 0.8], ["theme.growing-up", 0.9], ["theme.identity", 0.7], ["aftertaste.hopeful", 0.8]]),
  A("anime-a-silent-voice", "A Silent Voice", "Naoko Yamada", 2016, ["drama", "romance"], 130, 1, 0.65, [["theme.loneliness", 0.9], ["theme.growing-up", 0.8], ["tone.tender", 0.9], ["ache", 0.9], ["aftertaste.cathartic", 0.8]]),
  A("anime-death-note", "Death Note", "Tetsurō Araki", 2006, ["thriller", "mystery", "supernatural"], 23, 37, 0.85, [["register.cerebral", 0.9], ["theme.power", 0.9], ["theme.justice", 0.8], ["tone.cold", 0.6], ["pace", 0.75]]),
  A("anime-haikyuu", "Haikyu!!", "Susumu Mitsunaka", 2014, ["sports", "comedy", "drama"], 24, 85, 0.65, [["aftertaste.energized", 0.95], ["theme.friendship", 0.9], ["tone.earnest", 0.9], ["intensity", 0.7], ["aftertaste.hopeful", 0.8]]),
  A("anime-mushishi", "Mushishi", "Hiroshi Nagahama", 2005, ["fantasy", "mystery", "slice of life"], 24, 46, 0.35, [["register.meditative", 0.95], ["tone.serene", 0.9], ["theme.nature", 0.9], ["pace", 0.1], ["aftertaste.lingering", 0.8]]),
  A("anime-frieren", "Frieren: Beyond Journey's End", "Keiichirō Saitō", 2023, ["fantasy", "adventure", "drama"], 24, 28, 0.55, [["theme.time", 0.95], ["theme.grief", 0.7], ["theme.memory", 0.9], ["register.quiet", 0.85], ["tone.wistful", 0.9], ["aftertaste.bittersweet", 0.8]]),
  A("anime-princess-mononoke", "Princess Mononoke", "Hayao Miyazaki", 1997, ["fantasy", "adventure"], 134, 1, 0.75, [["theme.nature", 0.95], ["theme.violence", 0.6], ["register.epic", 0.9], ["tone.fierce", 0.7], ["theme.justice", 0.6]]),
  A("anime-spy-x-family", "Spy × Family", "Kazuhiro Furuhashi", 2022, ["comedy", "action", "family"], 24, 37, 0.6, [["tone.warm", 0.9], ["tone.playful", 0.9], ["theme.family", 0.95], ["aftertaste.comforting", 0.9]]),
  A("anime-monster", "Monster", "Masayuki Kojima", 2004, ["thriller", "mystery", "drama"], 24, 74, 0.45, [["tone.eerie", 0.8], ["register.cerebral", 0.8], ["theme.justice", 0.8], ["theme.madness", 0.8], ["pace", 0.3], ["aftertaste.haunting", 0.9]]),
  A("anime-jujutsu-kaisen", "Jujutsu Kaisen", "Sunghoo Park", 2020, ["action", "supernatural"], 24, 47, 0.75, [["intensity", 0.9], ["register.propulsive", 0.9], ["theme.death", 0.6], ["aftertaste.energized", 0.8]]),
  A("anime-march-comes-in-like-a-lion", "March Comes In Like a Lion", "Akiyuki Shinbo", 2016, ["drama", "slice of life"], 25, 44, 0.3, [["theme.loneliness", 0.9], ["theme.family", 0.8], ["tone.tender", 0.9], ["ache", 0.8], ["aftertaste.hopeful", 0.8]]),
  A("anime-hunter-x-hunter", "Hunter × Hunter", "Hiroshi Kōjina", 2011, ["adventure", "action", "fantasy"], 23, 148, 0.7, [["theme.friendship", 0.8], ["register.epic", 0.8], ["tone.playful", 0.6], ["intensity", 0.8], ["theme.power", 0.6]]),
  A("anime-perfect-blue", "Perfect Blue", "Satoshi Kon", 1997, ["thriller", "psychological"], 81, 1, 0.5, [["theme.identity", 0.95], ["theme.madness", 0.9], ["tone.eerie", 0.9], ["texture.dreamlike", 0.8], ["aftertaste.unsettling", 0.95]]),

  // ---- Books ----
  B("book-the-great-gatsby", "The Great Gatsby", "F. Scott Fitzgerald", 1925, ["literary", "classic"], 180, 0.9, [["theme.desire", 0.8], ["theme.class", 0.8], ["tone.wistful", 0.8], ["tone.lush", 0.7], ["aftertaste.bittersweet", 0.8]]),
  B("book-1984", "1984", "George Orwell", 1949, ["dystopia", "sci-fi", "classic"], 328, 0.9, [["theme.power", 0.95], ["theme.freedom", 0.9], ["tone.bleak", 0.9], ["aftertaste.unsettling", 0.9], ["tone.austere", 0.7]]),
  B("book-to-kill-a-mockingbird", "To Kill a Mockingbird", "Harper Lee", 1960, ["literary", "classic", "coming-of-age"], 281, 0.9, [["theme.justice", 0.95], ["theme.growing-up", 0.9], ["tone.warm", 0.6], ["tone.earnest", 0.8]]),
  B("book-normal-people", "Normal People", "Sally Rooney", 2018, ["literary", "romance"], 266, 0.7, [["theme.love", 0.9], ["theme.class", 0.6], ["register.intimate", 0.95], ["texture.spare", 0.8], ["ache", 0.9]]),
  B("book-a-little-life", "A Little Life", "Hanya Yanagihara", 2015, ["literary"], 720, 0.55, [["theme.friendship", 0.9], ["theme.survival", 0.8], ["ache", 0.95], ["intensity", 0.9], ["aftertaste.devastating", 0.95]]),
  B("book-the-road", "The Road", "Cormac McCarthy", 2006, ["literary", "dystopia"], 287, 0.65, [["theme.family", 0.9], ["theme.survival", 0.9], ["tone.bleak", 0.95], ["texture.spare", 0.95], ["tone.tender", 0.6]]),
  B("book-harry-potter-1", "Harry Potter and the Philosopher's Stone", "J. K. Rowling", 1997, ["fantasy", "children"], 223, 0.95, [["theme.wonder", 0.9], ["theme.friendship", 0.8], ["tone.warm", 0.8], ["aftertaste.comforting", 0.9], ["theme.home", 0.6]]),
  B("book-the-hobbit", "The Hobbit", "J. R. R. Tolkien", 1937, ["fantasy", "adventure"], 310, 0.85, [["theme.wonder", 0.8], ["theme.home", 0.8], ["tone.warm", 0.8], ["tone.playful", 0.6], ["aftertaste.comforting", 0.8]]),
  B("book-beloved", "Beloved", "Toni Morrison", 1987, ["literary", "historical"], 324, 0.6, [["theme.memory", 0.95], ["theme.grief", 0.9], ["aftertaste.haunting", 0.95], ["texture.dense", 0.8], ["intensity", 0.85]]),
  B("book-never-let-me-go", "Never Let Me Go", "Kazuo Ishiguro", 2005, ["literary", "sci-fi"], 288, 0.65, [["theme.memory", 0.9], ["theme.time", 0.8], ["register.quiet", 0.9], ["ache", 0.9], ["texture.spare", 0.7], ["aftertaste.devastating", 0.8]]),
  B("book-the-remains-of-the-day", "The Remains of the Day", "Kazuo Ishiguro", 1989, ["literary", "historical"], 258, 0.5, [["theme.time", 0.9], ["theme.desire", 0.6], ["register.quiet", 0.95], ["tone.austere", 0.6], ["ache", 0.9], ["aftertaste.bittersweet", 0.9]]),
  B("book-klara-and-the-sun", "Klara and the Sun", "Kazuo Ishiguro", 2021, ["literary", "sci-fi"], 303, 0.45, [["theme.love", 0.8], ["theme.faith", 0.7], ["tone.tender", 0.9], ["register.quiet", 0.9], ["ache", 0.8], ["aftertaste.bittersweet", 0.8]]),
  B("book-pride-and-prejudice", "Pride and Prejudice", "Jane Austen", 1813, ["romance", "classic"], 432, 0.9, [["tone.wry", 0.9], ["tone.romantic", 0.8], ["theme.class", 0.7], ["tone.playful", 0.7], ["aftertaste.comforting", 0.7]]),
  B("book-the-catcher-in-the-rye", "The Catcher in the Rye", "J. D. Salinger", 1951, ["literary", "coming-of-age"], 277, 0.85, [["theme.growing-up", 0.95], ["theme.loneliness", 0.9], ["register.confessional", 0.9], ["tone.wry", 0.7], ["tone.restless", 0.7]]),
  B("book-the-year-of-magical-thinking", "The Year of Magical Thinking", "Joan Didion", 2005, ["memoir", "grief"], 227, 0.45, [["theme.grief", 0.95], ["theme.memory", 0.8], ["texture.spare", 0.9], ["tone.cold", 0.5], ["tone.austere", 0.7], ["aftertaste.lingering", 0.9]]),
  B("book-the-little-prince", "The Little Prince", "Antoine de Saint-Exupéry", 1943, ["fable", "children", "classic"], 96, 0.85, [["theme.love", 0.8], ["theme.wonder", 0.8], ["tone.tender", 0.9], ["texture.spare", 0.8], ["aftertaste.bittersweet", 0.8]]),
  B("book-dune", "Dune", "Frank Herbert", 1965, ["sci-fi"], 412, 0.8, [["register.epic", 0.95], ["theme.power", 0.9], ["theme.faith", 0.7], ["texture.dense", 0.9], ["tone.austere", 0.6]]),
  B("book-piranesi", "Piranesi", "Susanna Clarke", 2020, ["fantasy", "literary"], 245, 0.45, [["theme.wonder", 0.95], ["theme.loneliness", 0.7], ["tone.serene", 0.8], ["texture.dreamlike", 0.9], ["register.meditative", 0.8], ["aftertaste.lingering", 0.8]]),
  B("book-crying-in-h-mart", "Crying in H Mart", "Michelle Zauner", 2021, ["memoir", "grief"], 256, 0.5, [["theme.grief", 0.95], ["theme.family", 0.95], ["theme.home", 0.8], ["register.confessional", 0.9], ["ache", 0.9], ["tone.tender", 0.7]]),
  B("book-the-alchemist", "The Alchemist", "Paulo Coelho", 1988, ["fable", "adventure"], 197, 0.8, [["theme.faith", 0.8], ["theme.freedom", 0.7], ["aftertaste.hopeful", 0.9], ["tone.earnest", 0.9], ["texture.spare", 0.7]]),
  B("book-kafka-on-the-shore", "Kafka on the Shore", "Haruki Murakami", 2002, ["literary", "fantasy"], 505, 0.6, [["texture.dreamlike", 0.95], ["theme.identity", 0.8], ["theme.loneliness", 0.8], ["tone.wistful", 0.7], ["aftertaste.haunting", 0.7]]),
  B("book-educated", "Educated", "Tara Westover", 2018, ["memoir"], 334, 0.6, [["theme.family", 0.9], ["theme.identity", 0.9], ["theme.freedom", 0.8], ["intensity", 0.8], ["register.confessional", 0.8]]),
  B("book-the-name-of-the-wind", "The Name of the Wind", "Patrick Rothfuss", 2007, ["fantasy"], 662, 0.55, [["theme.art", 0.8], ["theme.memory", 0.7], ["register.epic", 0.8], ["tone.lush", 0.8], ["texture.ornate", 0.7]]),

  // ---- Songs ----
  S("song-hallelujah-buckley", "Hallelujah", "Jeff Buckley", 1994, ["folk", "singer-songwriter"], 413, "Grace", 0.85, [["ache", 0.95], ["theme.faith", 0.7], ["theme.desire", 0.7], ["register.intimate", 0.9], ["aftertaste.devastating", 0.8]]),
  S("song-bohemian-rhapsody", "Bohemian Rhapsody", "Queen", 1975, ["rock"], 355, "A Night at the Opera", 0.95, [["register.epic", 0.95], ["tone.playful", 0.6], ["texture.ornate", 0.9], ["intensity", 0.8], ["aftertaste.energized", 0.8]]),
  S("song-motion-picture-soundtrack", "Motion Picture Soundtrack", "Radiohead", 2000, ["art rock", "electronic"], 419, "Kid A", 0.55, [["theme.death", 0.7], ["ache", 0.9], ["texture.hazy", 0.9], ["register.quiet", 0.8], ["aftertaste.haunting", 0.9]]),
  S("song-holocene", "Holocene", "Bon Iver", 2011, ["indie folk"], 337, "Bon Iver, Bon Iver", 0.6, [["theme.nature", 0.8], ["theme.memory", 0.7], ["tone.serene", 0.8], ["texture.hazy", 0.8], ["ache", 0.7], ["aftertaste.lingering", 0.9]]),
  S("song-both-sides-now", "Both Sides, Now", "Joni Mitchell", 1969, ["folk"], 273, "Clouds", 0.7, [["theme.time", 0.9], ["theme.memory", 0.8], ["tone.wistful", 0.95], ["register.intimate", 0.8], ["aftertaste.bittersweet", 0.9]]),
  S("song-runaway-kanye", "Runaway", "Kanye West", 2010, ["hip hop"], 547, "My Beautiful Dark Twisted Fantasy", 0.75, [["register.confessional", 0.9], ["register.epic", 0.8], ["theme.identity", 0.7], ["tone.lush", 0.7], ["aftertaste.cathartic", 0.8]]),
  S("song-the-night-we-met", "The Night We Met", "Lord Huron", 2015, ["indie folk"], 208, "Strange Trails", 0.75, [["theme.memory", 0.9], ["theme.love", 0.8], ["ache", 0.9], ["tone.wistful", 0.9], ["texture.hazy", 0.6]]),
  S("song-champagne-supernova", "Champagne Supernova", "Oasis", 1995, ["britpop", "rock"], 447, "(What's the Story) Morning Glory?", 0.8, [["theme.time", 0.7], ["tone.wistful", 0.8], ["texture.hazy", 0.8], ["register.epic", 0.7], ["aftertaste.lingering", 0.7]]),
  S("song-wide-open-spaces", "Wide Open Spaces", "The Chicks", 1998, ["country"], 224, "Wide Open Spaces", 0.55, [["theme.freedom", 0.95], ["theme.growing-up", 0.8], ["tone.warm", 0.7], ["aftertaste.hopeful", 0.9]]),
  S("song-nights-frank-ocean", "Nights", "Frank Ocean", 2016, ["r&b", "alternative"], 307, "Blonde", 0.75, [["theme.memory", 0.8], ["theme.time", 0.7], ["texture.hazy", 0.9], ["tone.melancholy", 0.7], ["aftertaste.lingering", 0.9]]),
  S("song-teardrop", "Teardrop", "Massive Attack", 1998, ["trip hop", "electronic"], 330, "Mezzanine", 0.7, [["texture.dreamlike", 0.9], ["register.meditative", 0.8], ["tone.eerie", 0.5], ["ache", 0.6], ["aftertaste.haunting", 0.8]]),
  S("song-fast-car", "Fast Car", "Tracy Chapman", 1988, ["folk", "singer-songwriter"], 296, "Tracy Chapman", 0.9, [["theme.class", 0.9], ["theme.freedom", 0.8], ["ache", 0.9], ["texture.spare", 0.8], ["aftertaste.bittersweet", 0.9]]),
  S("song-motion-sickness", "Motion Sickness", "Phoebe Bridgers", 2017, ["indie rock"], 231, "Stranger in the Alps", 0.6, [["tone.wry", 0.8], ["register.confessional", 0.9], ["ache", 0.7], ["tone.melancholy", 0.7], ["aftertaste.lingering", 0.6]]),
  S("song-god-only-knows", "God Only Knows", "The Beach Boys", 1966, ["pop", "baroque pop"], 175, "Pet Sounds", 0.8, [["theme.love", 0.95], ["tone.tender", 0.9], ["texture.ornate", 0.8], ["tone.earnest", 0.9], ["aftertaste.comforting", 0.7]]),
  S("song-seventeen-sharon-van-etten", "Seventeen", "Sharon Van Etten", 2019, ["indie rock"], 245, "Remind Me Tomorrow", 0.4, [["theme.growing-up", 0.9], ["theme.time", 0.9], ["tone.fierce", 0.6], ["ache", 0.8], ["aftertaste.cathartic", 0.8]]),
  S("song-clair-de-lune", "Clair de Lune", "Claude Debussy", 1905, ["classical"], 300, "Suite bergamasque", 0.8, [["tone.serene", 0.95], ["register.quiet", 0.9], ["texture.dreamlike", 0.8], ["pace", 0.15], ["aftertaste.comforting", 0.7]]),
  S("song-all-too-well-10", "All Too Well (10 Minute Version)", "Taylor Swift", 2021, ["pop", "singer-songwriter"], 613, "Red (Taylor's Version)", 0.85, [["theme.memory", 0.95], ["theme.love", 0.8], ["register.confessional", 0.95], ["ache", 0.9], ["aftertaste.cathartic", 0.85]]),
  S("song-blue-in-green", "Blue in Green", "Miles Davis", 1959, ["jazz"], 337, "Kind of Blue", 0.6, [["tone.melancholy", 0.9], ["register.meditative", 0.9], ["register.quiet", 0.9], ["pace", 0.1], ["aftertaste.lingering", 0.8]]),
  S("song-dancing-on-my-own", "Dancing On My Own", "Robyn", 2010, ["synth-pop", "dance"], 288, "Body Talk Pt. 1", 0.75, [["theme.loneliness", 0.9], ["aftertaste.energized", 0.9], ["ache", 0.8], ["register.propulsive", 0.8], ["aftertaste.cathartic", 0.8]]),
  S("song-re-stacks", "Re: Stacks", "Bon Iver", 2007, ["indie folk"], 401, "For Emma, Forever Ago", 0.45, [["theme.loneliness", 0.8], ["register.intimate", 0.95], ["texture.spare", 0.95], ["texture.raw", 0.8], ["ache", 0.8], ["aftertaste.lingering", 0.8]]),
  S("song-skinny-love", "Skinny Love", "Bon Iver", 2007, ["indie folk"], 238, "For Emma, Forever Ago", 0.75, [["theme.love", 0.8], ["register.intimate", 0.9], ["texture.raw", 0.9], ["ache", 0.9], ["intensity", 0.6]]),
  S("song-flume", "Flume", "Bon Iver", 2007, ["indie folk"], 219, "For Emma, Forever Ago", 0.4, [["theme.loneliness", 0.7], ["texture.raw", 0.9], ["texture.spare", 0.8], ["register.intimate", 0.9], ["ache", 0.7]]),
  S("song-everything-is-free", "Everything Is Free", "Gillian Welch", 2001, ["folk", "americana"], 291, "Time (The Revelator)", 0.3, [["theme.art", 0.9], ["theme.class", 0.5], ["texture.spare", 0.9], ["tone.wry", 0.6], ["ache", 0.7], ["register.quiet", 0.8]]),
  S("song-heroes", "Heroes", "David Bowie", 1977, ["art rock"], 371, "Heroes", 0.85, [["theme.love", 0.8], ["theme.freedom", 0.7], ["register.epic", 0.8], ["aftertaste.energized", 0.8], ["aftertaste.hopeful", 0.8]]),
  S("song-strange-fruit", "Strange Fruit", "Billie Holiday", 1939, ["jazz", "blues"], 194, "Strange Fruit", 0.55, [["theme.justice", 0.95], ["theme.violence", 0.8], ["tone.austere", 0.8], ["intensity", 0.9], ["aftertaste.haunting", 0.95]]),
];

export const CANON_BY_SLUG = new Map(CANON.map((c) => [c.slug, c]));
