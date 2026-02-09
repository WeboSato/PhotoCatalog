import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

let session: any = null;
let labels: string[] = [];
let available: boolean | null = null;

// English -> French translation for common ImageNet labels
const EN_TO_FR: Record<string, string> = {
    // Animals
    'dog': 'chien', 'cat': 'chat', 'bird': 'oiseau', 'fish': 'poisson', 'horse': 'cheval',
    'cow': 'vache', 'sheep': 'mouton', 'pig': 'cochon', 'chicken': 'poulet', 'duck': 'canard',
    'goose': 'oie', 'rabbit': 'lapin', 'mouse': 'souris', 'rat': 'rat', 'bear': 'ours',
    'wolf': 'loup', 'fox': 'renard', 'deer': 'cerf', 'elephant': 'éléphant', 'lion': 'lion',
    'tiger': 'tigre', 'monkey': 'singe', 'gorilla': 'gorille', 'snake': 'serpent',
    'turtle': 'tortue', 'frog': 'grenouille', 'lizard': 'lézard', 'butterfly': 'papillon',
    'bee': 'abeille', 'spider': 'araignée', 'ant': 'fourmi', 'eagle': 'aigle', 'owl': 'hibou',
    'penguin': 'pingouin', 'whale': 'baleine', 'dolphin': 'dauphin', 'shark': 'requin',
    'goldfish': 'poisson rouge', 'parrot': 'perroquet', 'peacock': 'paon', 'swan': 'cygne',
    'lobster': 'homard', 'crab': 'crabe', 'snail': 'escargot', 'jellyfish': 'méduse',
    'squirrel': 'écureuil', 'hamster': 'hamster', 'panda': 'panda', 'zebra': 'zèbre',
    'giraffe': 'girafe', 'camel': 'chameau', 'donkey': 'âne', 'rooster': 'coq',
    'kitten': 'chaton', 'puppy': 'chiot', 'poodle': 'caniche', 'husky': 'husky',
    'tabby': 'chat tigré', 'persian cat': 'chat persan', 'siamese cat': 'chat siamois',
    'german shepherd': 'berger allemand', 'golden retriever': 'golden retriever',
    'labrador retriever': 'labrador', 'bull terrier': 'bull terrier',
    'chihuahua': 'chihuahua', 'dalmatian': 'dalmatien', 'collie': 'colley',
    'beagle': 'beagle', 'boxer': 'boxer', 'pug': 'carlin', 'rottweiler': 'rottweiler',
    'hummingbird': 'colibri', 'flamingo': 'flamant rose', 'pelican': 'pélican',
    'starfish': 'étoile de mer', 'coral reef': 'récif corallien', 'scorpion': 'scorpion',
    'dragonfly': 'libellule', 'ladybug': 'coccinelle', 'caterpillar': 'chenille',
    'cockroach': 'cafard', 'grasshopper': 'sauterelle', 'centipede': 'mille-pattes',
    // Dog breeds
    'afghan hound': 'lévrier afghan', 'basset': 'basset', 'bloodhound': 'limier',
    'bluetick': 'bluetick', 'borzoi': 'barzoï', 'briard': 'briard',
    'cocker spaniel': 'cocker spaniel', 'doberman': 'doberman',
    'great dane': 'dogue allemand', 'irish setter': 'setter irlandais',
    'maltese dog': 'bichon maltais', 'newfoundland': 'terre-neuve',
    'saint bernard': 'saint-bernard', 'samoyed': 'samoyède',
    'scottish terrier': 'terrier écossais', 'shih-tzu': 'shih tzu',
    'siberian husky': 'husky sibérien', 'yorkshire terrier': 'yorkshire',
    'weimaraner': 'braque de weimar', 'whippet': 'whippet',
    // Nature
    'flower': 'fleur', 'tree': 'arbre', 'forest': 'forêt', 'mountain': 'montagne',
    'lake': 'lac', 'river': 'rivière', 'ocean': 'océan', 'beach': 'plage',
    'sky': 'ciel', 'cloud': 'nuage', 'sun': 'soleil', 'moon': 'lune', 'star': 'étoile',
    'rain': 'pluie', 'snow': 'neige', 'grass': 'herbe', 'garden': 'jardin',
    'park': 'parc', 'field': 'champ', 'hill': 'colline', 'valley': 'vallée',
    'waterfall': 'cascade', 'island': 'île', 'desert': 'désert', 'jungle': 'jungle',
    'cliff': 'falaise', 'cave': 'grotte', 'volcano': 'volcan', 'reef': 'récif',
    'sunrise': 'lever de soleil', 'sunset': 'coucher de soleil', 'rainbow': 'arc-en-ciel',
    'mushroom': 'champignon', 'daisy': 'marguerite', 'rose': 'rose', 'tulip': 'tulipe',
    'sunflower': 'tournesol', 'orchid': 'orchidée', 'lily': 'lys',
    'coral fungus': 'champignon corail', 'hen-of-the-woods': 'poule des bois',
    'acorn': 'gland', 'maple': 'érable', 'oak': 'chêne', 'pine': 'pin',
    // Food
    'food': 'nourriture', 'fruit': 'fruit', 'apple': 'pomme', 'banana': 'banane',
    'orange': 'orange', 'strawberry': 'fraise', 'grape': 'raisin', 'lemon': 'citron',
    'pineapple': 'ananas', 'watermelon': 'melon d\'eau', 'cherry': 'cerise',
    'peach': 'pêche', 'pear': 'poire', 'bread': 'pain', 'cake': 'gâteau',
    'pizza': 'pizza', 'hamburger': 'hamburger', 'ice cream': 'crème glacée',
    'chocolate': 'chocolat', 'cheese': 'fromage', 'egg': 'oeuf', 'meat': 'viande',
    'soup': 'soupe', 'salad': 'salade', 'wine': 'vin', 'beer': 'bière',
    'coffee': 'café', 'tea': 'thé', 'milk': 'lait', 'juice': 'jus',
    'corn': 'maïs', 'broccoli': 'brocoli', 'carrot': 'carotte', 'potato': 'pomme de terre',
    'tomato': 'tomate', 'cucumber': 'concombre', 'pepper': 'poivron', 'onion': 'oignon',
    'garlic': 'ail', 'lettuce': 'laitue',
    'espresso': 'espresso', 'cup': 'tasse', 'plate': 'assiette', 'bowl': 'bol',
    'bagel': 'bagel', 'pretzel': 'bretzel', 'cheeseburger': 'cheeseburger',
    'hot dog': 'hot-dog', 'french loaf': 'baguette', 'meatloaf': 'pain de viande',
    // Vehicles
    'car': 'voiture', 'truck': 'camion', 'bus': 'autobus', 'train': 'train',
    'airplane': 'avion', 'boat': 'bateau', 'ship': 'navire', 'bicycle': 'vélo',
    'motorcycle': 'moto', 'helicopter': 'hélicoptère', 'taxi': 'taxi',
    'ambulance': 'ambulance', 'fire engine': 'camion de pompier',
    'police van': 'fourgon de police', 'jeep': 'jeep', 'limousine': 'limousine',
    'minivan': 'fourgonnette', 'sports car': 'voiture de sport',
    'convertible': 'décapotable', 'pickup': 'camionnette',
    'snowplow': 'chasse-neige', 'tractor': 'tracteur', 'tank': 'char',
    'canoe': 'canoë', 'sailboat': 'voilier', 'speedboat': 'hors-bord',
    'gondola': 'gondole', 'catamaran': 'catamaran', 'kayak': 'kayak',
    // Buildings & Places
    'house': 'maison', 'building': 'bâtiment', 'church': 'église', 'castle': 'château',
    'bridge': 'pont', 'tower': 'tour', 'school': 'école', 'hospital': 'hôpital',
    'restaurant': 'restaurant', 'hotel': 'hôtel', 'museum': 'musée',
    'library': 'bibliothèque', 'stadium': 'stade', 'palace': 'palais',
    'mosque': 'mosquée', 'temple': 'temple', 'cathedral': 'cathédrale',
    'barn': 'grange', 'lighthouse': 'phare', 'windmill': 'moulin à vent',
    'dam': 'barrage', 'fountain': 'fontaine', 'greenhouse': 'serre',
    'cinema': 'cinéma', 'theater': 'théâtre', 'bakery': 'boulangerie',
    // Objects
    'chair': 'chaise', 'table': 'table', 'bed': 'lit', 'desk': 'bureau',
    'lamp': 'lampe', 'mirror': 'miroir', 'clock': 'horloge', 'phone': 'téléphone',
    'computer': 'ordinateur', 'keyboard': 'clavier', 'book': 'livre', 'pen': 'stylo',
    'camera': 'appareil photo', 'television': 'télévision', 'radio': 'radio',
    'guitar': 'guitare', 'piano': 'piano', 'violin': 'violon', 'drum': 'tambour',
    'umbrella': 'parapluie', 'hat': 'chapeau', 'shoe': 'chaussure', 'bag': 'sac',
    'bottle': 'bouteille', 'glass': 'verre', 'key': 'clé', 'door': 'porte',
    'window': 'fenêtre', 'fence': 'clôture', 'wall': 'mur', 'roof': 'toit',
    'pillow': 'oreiller', 'blanket': 'couverture', 'candle': 'bougie',
    'vase': 'vase', 'basket': 'panier', 'scissors': 'ciseaux', 'hammer': 'marteau',
    'nail': 'clou', 'screw': 'vis', 'rope': 'corde', 'chain': 'chaîne',
    'bell': 'cloche', 'flag': 'drapeau', 'sign': 'panneau', 'map': 'carte',
    'envelope': 'enveloppe', 'newspaper': 'journal', 'magazine': 'magazine',
    'notebook': 'cahier', 'backpack': 'sac à dos', 'suitcase': 'valise',
    'sunglasses': 'lunettes de soleil', 'watch': 'montre', 'ring': 'bague',
    'necklace': 'collier', 'bracelet': 'bracelet', 'tie': 'cravate',
    'coat': 'manteau', 'jacket': 'veste', 'shirt': 'chemise', 'dress': 'robe',
    'skirt': 'jupe', 'pants': 'pantalon', 'sock': 'chaussette', 'glove': 'gant',
    'scarf': 'écharpe', 'boot': 'botte', 'sandal': 'sandale', 'slipper': 'pantoufle',
    'lipstick': 'rouge à lèvres', 'perfume': 'parfum', 'lotion': 'lotion',
    'toothbrush': 'brosse à dents', 'comb': 'peigne', 'towel': 'serviette',
    'toilet tissue': 'papier toilette', 'soap dispenser': 'distributeur de savon',
    'laptop': 'portable', 'cellphone': 'cellulaire', 'remote control': 'télécommande',
    'joystick': 'manette', 'iPod': 'iPod', 'loudspeaker': 'haut-parleur',
    'microphone': 'microphone', 'headphone': 'casque audio',
    // Sports & activities
    'ball': 'ballon', 'tennis': 'tennis', 'soccer': 'soccer', 'basketball': 'basketball',
    'baseball': 'baseball', 'golf': 'golf', 'swimming': 'natation',
    'ski': 'ski', 'surfboard': 'planche de surf', 'skateboard': 'planche à roulettes',
    'snowboard': 'planche à neige', 'racket': 'raquette', 'ping-pong ball': 'balle de ping-pong',
    'volleyball': 'volleyball', 'rugby ball': 'ballon de rugby',
    // People
    'person': 'personne', 'baby': 'bébé', 'child': 'enfant', 'man': 'homme',
    'woman': 'femme', 'boy': 'garçon', 'girl': 'fille', 'family': 'famille',
    'group': 'groupe', 'crowd': 'foule', 'wedding': 'mariage',
    'groom': 'marié', 'bride': 'mariée',
    // Weather & time
    'fog': 'brouillard', 'storm': 'tempête', 'lightning': 'éclair', 'ice': 'glace',
    'frost': 'gel', 'wind': 'vent', 'fire': 'feu', 'smoke': 'fumée',
    // Music instruments
    'accordion': 'accordéon', 'banjo': 'banjo', 'cello': 'violoncelle',
    'flute': 'flûte', 'harmonica': 'harmonica', 'harp': 'harpe',
    'oboe': 'hautbois', 'organ': 'orgue', 'saxophone': 'saxophone',
    'trombone': 'trombone', 'trumpet': 'trompette',
    'french horn': 'cor français', 'acoustic guitar': 'guitare acoustique',
    'electric guitar': 'guitare électrique', 'grand piano': 'piano à queue',
    'upright': 'piano droit', 'maraca': 'maraca',
    // Misc common labels from ImageNet
    'bookshop': 'librairie', 'grocery store': 'épicerie', 'barbershop': 'salon de coiffure',
    'toyshop': 'magasin de jouets', 'street sign': 'panneau de rue',
    'traffic light': 'feu de circulation', 'mailbox': 'boîte aux lettres',
    'park bench': 'banc de parc', 'picket fence': 'clôture',
    'stone wall': 'mur de pierre', 'lakeside': 'bord du lac',
    'seashore': 'bord de mer', 'promontory': 'promontoire',
    'sandbar': 'banc de sable', 'alp': 'alpe',
};

function translateKeyword(en: string): string | null {
    // Direct match
    if (EN_TO_FR[en]) return EN_TO_FR[en];

    // Try matching individual words for compound labels
    const words = en.split(/[\s,_-]+/);
    for (const word of words) {
        if (EN_TO_FR[word]) return EN_TO_FR[word];
    }

    return null;
}

function getModelDir(): string {
    // In production: resources/ai-model inside app bundle
    // In dev: resources/ai-model in project root
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'resources', 'ai-model');
    }
    return path.join(app.getAppPath(), 'resources', 'ai-model');
}

export async function initializeAI(): Promise<boolean> {
    if (available === true && session) return true;

    try {
        const ort = require('onnxruntime-node');
        const modelDir = getModelDir();
        const modelPath = path.join(modelDir, 'mobilenet_v2.onnx');
        const labelsPath = path.join(modelDir, 'imagenet_labels.json');

        if (!fs.existsSync(modelPath)) {
            console.error('[AI] Model file not found:', modelPath);
            available = false;
            return false;
        }

        if (!fs.existsSync(labelsPath)) {
            console.error('[AI] Labels file not found:', labelsPath);
            available = false;
            return false;
        }

        // Load labels
        labels = JSON.parse(fs.readFileSync(labelsPath, 'utf-8'));
        console.log(`[AI] Loaded ${labels.length} ImageNet labels`);

        // Load ONNX model (CPU only - no GPU needed)
        session = await ort.InferenceSession.create(modelPath, {
            executionProviders: ['cpu']
        });

        available = true;
        console.log('[AI] MobileNet v2 model loaded (CPU mode, ~14MB)');
        return true;
    } catch (error) {
        console.error('[AI] Failed to initialize:', error);
        available = false;
        return false;
    }
}

export async function analyzeImage(imagePath: string): Promise<string[]> {
    if (!available || !session) {
        const ok = await initializeAI();
        if (!ok) throw new Error('AI model not available');
    }

    const ort = require('onnxruntime-node');
    const sharp = require('sharp');

    // Preprocess image: resize to 224x224, normalize to ImageNet mean/std
    const { data, info } = await sharp(imagePath)
        .resize(224, 224, { fit: 'cover' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    // Convert HWC uint8 to CHW float32 with ImageNet normalization
    // mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225]
    const mean = [0.485, 0.456, 0.406];
    const std = [0.229, 0.224, 0.225];
    const float32Data = new Float32Array(3 * 224 * 224);

    for (let y = 0; y < 224; y++) {
        for (let x = 0; x < 224; x++) {
            const srcIdx = (y * 224 + x) * 3;
            for (let c = 0; c < 3; c++) {
                const dstIdx = c * 224 * 224 + y * 224 + x;
                float32Data[dstIdx] = (data[srcIdx + c] / 255.0 - mean[c]) / std[c];
            }
        }
    }

    // Run inference
    const inputTensor = new ort.Tensor('float32', float32Data, [1, 3, 224, 224]);
    const results = await session.run({ input: inputTensor });
    const output = results.output.data as Float32Array;

    // Apply softmax to get probabilities
    const maxVal = Math.max(...Array.from(output));
    const exps = Array.from(output).map(v => Math.exp(v - maxVal));
    const sumExp = exps.reduce((a, b) => a + b, 0);
    const probs = exps.map(e => e / sumExp);

    // Get top predictions with score > 0.02
    const indexed = probs.map((p, i) => ({ prob: p, index: i }));
    indexed.sort((a, b) => b.prob - a.prob);

    // Words too generic to be useful as keywords
    const EXCLUDED_WORDS = new Set([
        'background', 'object', 'image', 'scene', 'photo', 'picture',
        'web site', 'website', 'screen', 'monitor', 'display',
        'analog clock', 'digital clock', 'wall clock',
        'rule', 'measuring', 'scale',
    ]);

    const englishKeywords: string[] = [];
    for (const item of indexed.slice(0, 10)) {
        if (item.prob < 0.02) break;

        const label = labels[item.index];
        if (!label) continue;

        // Clean up label - remove parenthetical, trim
        const cleaned = label
            .toLowerCase()
            .replace(/\s*\([^)]*\)\s*/g, '')
            .trim();

        // Skip empty, too short, or excluded keywords
        if (!cleaned || cleaned.length < 3) continue;
        if (EXCLUDED_WORDS.has(cleaned)) continue;
        if (englishKeywords.includes(cleaned)) continue;

        englishKeywords.push(cleaned);
    }

    // Build bilingual keyword list: English + French
    const allKeywords = new Set<string>();
    for (const en of englishKeywords.slice(0, 8)) {
        allKeywords.add(en);
        const fr = translateKeyword(en);
        if (fr && fr !== en) {
            allKeywords.add(fr);
        }
    }

    const result = Array.from(allKeywords);
    console.log(`[AI] Keywords for ${path.basename(imagePath)}: [${result.join(', ')}]`);
    return result;
}

export function isAIReady(): boolean {
    return available === true;
}
