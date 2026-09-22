// Deterministic mock extraction: a hand-written lexicon from everyday words people
// use about things they love, into the shared vocabulary. Not clever, but honest and
// debuggable. The real extractor (Claude) replaces this when a key is present.

export type Rule = { match: RegExp; tags: Array<[string, number]> };

const r = (pattern: string, tags: Array<[string, number]>): Rule => ({ match: new RegExp(`\\b(?:${pattern})\\b`, "i"), tags });

export const LEXICON: Rule[] = [
  // devastation / ache
  r("wrecked|destroyed|gutted|devastat\\w*|shattered|broke me|broken", [["aftertaste.devastating", 0.9], ["ache", 0.9], ["intensity", 0.85], ["tone.melancholy", 0.5]]),
  r("cried|crying|sobbed|sobbing|tears|weep\\w*|teared up", [["aftertaste.cathartic", 0.7], ["ache", 0.8], ["intensity", 0.7], ["tone.tender", 0.4]]),
  r("ache|aching|achy|longing|yearn\\w*|pining", [["ache", 0.9], ["tone.wistful", 0.7], ["aftertaste.lingering", 0.6]]),
  r("sad|sadness|sorrow\\w*|mourn\\w*|grief|grieving|griev\\w*|loss|lost someone|bereav\\w*", [["theme.grief", 0.85], ["ache", 0.7], ["tone.melancholy", 0.6]]),
  r("melanchol\\w*|blue|bittersweet|wistful", [["tone.melancholy", 0.8], ["aftertaste.bittersweet", 0.75], ["ache", 0.5]]),
  r("heartbreak\\w*|heartbroken|broke my heart", [["ache", 0.9], ["theme.love", 0.7], ["aftertaste.devastating", 0.6]]),

  // quiet / slow
  r("quiet|quietly|hushed|still|stillness|silence|silent", [["register.quiet", 0.85], ["pace", 0.25], ["tone.serene", 0.3]]),
  r("slow|slowly|slow[- ]burn|patient|unhurried|takes its time|meditative|contemplative", [["pace", 0.15], ["register.meditative", 0.8], ["aftertaste.lingering", 0.4]]),
  r("gentle|gently|soft|softly|tender|tenderness|delicate", [["tone.tender", 0.85], ["register.intimate", 0.5], ["intensity", 0.35]]),
  r("intimate|intimacy|close|personal|small|tiny|domestic", [["register.intimate", 0.85], ["texture.spare", 0.4]]),
  r("spare|sparse|minimal\\w*|restrained|understated|subtle", [["texture.spare", 0.85], ["register.quiet", 0.5], ["intensity", 0.3]]),

  // warmth / comfort
  r("comfort\\w*|cozy|cosy|safe|soothing|soothes|warm|warmth|warmed|hug", [["aftertaste.comforting", 0.85], ["tone.warm", 0.8], ["intensity", 0.3]]),
  r("hope|hopeful|uplifting|healing|heals|light at the end", [["aftertaste.hopeful", 0.85], ["tone.warm", 0.5]]),
  r("joy|joyful|joyous|delight\\w*|happy|happiness|glow\\w*", [["tone.warm", 0.75], ["aftertaste.hopeful", 0.6], ["aftertaste.energized", 0.4]]),
  r("funny|hilarious|laughed|laughing|comedy|comic|witty|wit", [["tone.playful", 0.8], ["tone.wry", 0.6], ["aftertaste.energized", 0.4]]),
  r("wry|dry|deadpan|sardonic|ironic|irony|sly", [["tone.wry", 0.85], ["register.cerebral", 0.4]]),
  r("playful|fun|charming|charm|whimsical|silly|goofy", [["tone.playful", 0.85], ["tone.warm", 0.4]]),
  r("romantic|romance|swoon\\w*|crush|in love|fell in love|love story", [["tone.romantic", 0.85], ["theme.love", 0.8], ["theme.desire", 0.4]]),

  // dark / unsettling
  r("bleak|hopeless|grim|nihilis\\w*|despair\\w*|crushing", [["tone.bleak", 0.9], ["aftertaste.numb", 0.5], ["intensity", 0.6]]),
  r("cold|clinical|detached|distant|austere|severe|stark", [["tone.austere", 0.75], ["tone.cold", 0.7], ["texture.spare", 0.5]]),
  r("eerie|creepy|unsettling|unnerving|uneasy|dread|ominous|sinister|chilling", [["tone.eerie", 0.85], ["aftertaste.unsettling", 0.85], ["intensity", 0.6]]),
  r("scary|terrif\\w*|horrif\\w*|frighten\\w*|nightmare\\w*|haunt\\w*|ghost\\w*", [["aftertaste.haunting", 0.85], ["tone.eerie", 0.7], ["intensity", 0.7]]),
  r("brutal|violent|violence|savage|vicious|bloody|gore", [["theme.violence", 0.85], ["intensity", 0.85], ["texture.gritty", 0.6]]),
  r("disturb\\w*|sick\\w*|nauseat\\w*|hard to watch|hard to read", [["aftertaste.unsettling", 0.8], ["intensity", 0.8], ["texture.raw", 0.5]]),
  r("numb|empty|hollow|drained|flat", [["aftertaste.numb", 0.85], ["tone.bleak", 0.4], ["intensity", 0.4]]),
  r("mad\\w*|insan\\w*|unhinged|deranged|paranoi\\w*|spiral\\w*", [["theme.madness", 0.8], ["tone.restless", 0.5], ["intensity", 0.7]]),

  // intensity / energy
  r("intense|intensity|relentless|overwhelming|visceral|ferocious|fierce|blistering", [["intensity", 0.9], ["tone.fierce", 0.7], ["pace", 0.7]]),
  r("thrilling|adrenaline|breathless|pulse|propulsive|kinetic|fast|frantic|breakneck", [["register.propulsive", 0.85], ["pace", 0.9], ["aftertaste.energized", 0.7]]),
  r("loud|noisy|abrasive|screaming|shout\\w*|roar\\w*|anthem\\w*", [["register.loud", 0.85], ["intensity", 0.7], ["aftertaste.energized", 0.6]]),
  r("angry|anger|rage|furious|fury|seething", [["tone.fierce", 0.85], ["intensity", 0.8], ["theme.justice", 0.3]]),
  r("energy|energis\\w*|energiz\\w*|electric|exhilarat\\w*|euphori\\w*|ecstatic|dance\\w*", [["aftertaste.energized", 0.9], ["pace", 0.8], ["tone.playful", 0.3]]),
  r("epic|sweeping|grand|vast|enormous|monumental|huge|massive", [["register.epic", 0.9], ["texture.dense", 0.4], ["theme.wonder", 0.4]]),
  r("restless|anxious|anxiety|tense|tension|nervous|jittery", [["tone.restless", 0.85], ["intensity", 0.6], ["aftertaste.unsettling", 0.4]]),

  // texture
  r("dreamy|dreamlike|surreal|hazy|woozy|floaty|trance\\w*|hypnotic", [["texture.dreamlike", 0.85], ["texture.hazy", 0.7], ["register.meditative", 0.5]]),
  r("gritty|grimy|dirty|raw|rough|unpolished|unvarnished|ugly", [["texture.gritty", 0.8], ["texture.raw", 0.8]]),
  r("lush|sumptuous|opulent|ornate|baroque|lavish|ravishing", [["tone.lush", 0.85], ["texture.ornate", 0.7]]),
  r("rich|gorgeous|beautiful|beauty", [["tone.lush", 0.45], ["theme.wonder", 0.3]]),
  r("dense|layered|complex|intricate|sprawling|labyrinth\\w*", [["texture.dense", 0.85], ["register.cerebral", 0.5]]),
  r("polished|precise|elegant|pristine|immaculate|clean|crisp", [["texture.polished", 0.85]]),
  r("clever|smart|brilliant|cerebral|intellectual|ideas|philosoph\\w*|thought[- ]provoking", [["register.cerebral", 0.85], ["texture.dense", 0.4]]),
  r("honest|confessional|vulnerable|naked|bare|diary|journal", [["register.confessional", 0.85], ["texture.raw", 0.6], ["register.intimate", 0.5]]),
  r("serene|calm|peaceful|tranquil|placid|zen", [["tone.serene", 0.9], ["register.meditative", 0.6], ["pace", 0.2]]),
  r("earnest|sincere|heartfelt|unironic|wholehearted", [["tone.earnest", 0.85], ["tone.warm", 0.4]]),

  // aftertaste
  r("stayed with me|stuck with me|can't stop thinking|cannot stop thinking|still thinking|lingers|lingering|won't leave|haven't stopped", [["aftertaste.lingering", 0.95]]),
  r("cathartic|catharsis|release|purg\\w*|cleansing", [["aftertaste.cathartic", 0.9], ["intensity", 0.6]]),
  r("changed me|changed how|changed the way|rewired|reframed|see the world differently|perspective", [["register.cerebral", 0.5], ["aftertaste.lingering", 0.7], ["theme.identity", 0.4]]),

  // themes
  r("memory|memories|remember\\w*|nostalgi\\w*|childhood|the past", [["theme.memory", 0.85], ["tone.wistful", 0.6]]),
  r("lonely|loneliness|alone|isolat\\w*|solitude|solitary", [["theme.loneliness", 0.9], ["ache", 0.5], ["register.quiet", 0.4]]),
  r("growing up|coming[- ]of[- ]age|adolescen\\w*|teenage\\w*|youth|young", [["theme.growing-up", 0.85], ["tone.wistful", 0.4]]),
  r("obsess\\w*|fixat\\w*|consum\\w*|compulsi\\w*|addict\\w*", [["theme.obsession", 0.85], ["intensity", 0.6]]),
  r("family|families|mother|father|mom|dad|parent\\w*|sibling\\w*|brother|sister|daughter|son", [["theme.family", 0.85]]),
  r("home|homesick|belong\\w*|roots|hometown|small town", [["theme.home", 0.85], ["tone.wistful", 0.4]]),
  r("faith|god|religio\\w*|prayer|spiritual|grace|belief", [["theme.faith", 0.85], ["register.meditative", 0.3]]),
  r("class|poverty|poor|rich|money|working[- ]class|inequality|capitalis\\w*", [["theme.class", 0.85]]),
  r("time|years|decades|passing|ageing|aging|growing old|mortality", [["theme.time", 0.8], ["theme.death", 0.3], ["tone.wistful", 0.4]]),
  r("identity|who i am|who you are|becoming|self", [["theme.identity", 0.85]]),
  r("free|freedom|escape|liberat\\w*|run away|open road", [["theme.freedom", 0.85], ["aftertaste.energized", 0.3]]),
  r("death|dying|died|dead|mortality|funeral|terminal", [["theme.death", 0.85], ["theme.grief", 0.5], ["ache", 0.5]]),
  r("friend\\w*|friendship|companion\\w*|found family", [["theme.friendship", 0.85], ["tone.warm", 0.5]]),
  r("art|artist\\w*|creat\\w*|making things|craft|painting|music itself", [["theme.art", 0.8]]),
  r("nature|landscape|mountain\\w*|forest|ocean|sea|river|wilderness|weather", [["theme.nature", 0.85], ["tone.serene", 0.3]]),
  r("power|control|politic\\w*|empire|tyran\\w*|corrupt\\w*|war", [["theme.power", 0.85], ["intensity", 0.5]]),
  r("desire|lust|want\\w* (?:her|him|them)|erotic|sensual|longing for", [["theme.desire", 0.85], ["tone.romantic", 0.4]]),
  r("surviv\\w*|endur\\w*|persever\\w*|keep going|hold on", [["theme.survival", 0.85], ["intensity", 0.5]]),
  r("justice|injustice|revenge|vengeance|wrong\\w*|fair", [["theme.justice", 0.85]]),
  r("wonder|awe|marvel\\w*|magic\\w*|sublime|transcend\\w*", [["theme.wonder", 0.85], ["register.epic", 0.4], ["aftertaste.hopeful", 0.3]]),
  r("love|loved it|adore\\w*|cherish\\w*", [["theme.love", 0.5], ["tone.warm", 0.3]]),
];

/** Preference evidence is separate from the descriptive reading vector. */
export const DISLIKE_MARKER = /\b(?:hate(?:d)?|dislike(?:d)?|did(?:n't| not) work|could(?:n't| not) stand|not for me|boring|dragged|too)\b/i;
export const VALUED_MARKER = /\b(?:love(?:d)?|like(?:d)?|adore(?:d)?|appreciate(?:d)?|favorite|favourite|what worked)\b/i;

/** Applied only inside a sentence that also contains DISLIKE_MARKER. */
export const DISLIKE_LEXICON: Rule[] = [
  r("slow|sluggish|dragged|draggy|pacing", [["pace", 0.15]]),
  r("fast|rushed|frantic|breakneck", [["pace", 0.9]]),
  r("intense|overwhelming|relentless", [["intensity", 0.9]]),
  r("bleak|hopeless|depressing|grim", [["tone.bleak", 0.85]]),
  r("cold|detached|distant", [["tone.cold", 0.8]]),
  r("loud|noisy|abrasive", [["register.loud", 0.85]]),
  r("dense|confusing|complicated|convoluted", [["texture.dense", 0.8], ["complexity", 0.85]]),
  r("violent|violence|gory|gore", [["theme.violence", 0.85]]),
];
