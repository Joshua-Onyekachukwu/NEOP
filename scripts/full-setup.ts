/**
 * Full Setup Script
 * Creates tables, imports Nigerian electoral data
 * Run: npx tsx scripts/full-setup.ts
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lgdubqovtyvzckvpbtrs.supabase.co';
const supabaseServiceRoleKey = '';

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

// ============================================================
// NIGERIAN STATES AND LGAs
// ============================================================

const STATES_LGAS: Record<string, string[]> = {
  'Abia': ['Aba North', 'Aba South', 'Arochukwu', 'Bende', 'Ikwuano', 'Isiala Ngwa North', 'Isiala Ngwa South', 'Isuikwuato', 'Obi Ngwa', 'Ohafia', 'Osisioma', 'Ugwunagbo', 'Ukwa East', 'Ukwa West', 'Umuahia North', 'Umuahia South', 'Umu Nneochi'],
  'Adamawa': ['Demsa', 'Fufore', 'Ganaye', 'Girei', 'Gombi', 'Guyuk', 'Hong', 'Jada', 'Lamurde', 'Madagali', 'Maiha', 'Mayo Belwa', 'Michika', 'Mubi North', 'Mubi South', 'Numan', 'Shelleng', 'Song', 'Toungo', 'Yola North', 'Yola South'],
  'Akwa Ibom': ['Abak', 'Eastern Obolo', 'Eket', 'Esit Eket', 'Essien Udim', 'Etim Ekpo', 'Etinan', 'Ibeno', 'Ibesikpo Asutan', 'Ibiono Ibom', 'Ika', 'Ikono', 'Ikot Abasi', 'Ikot Ekpene', 'Ini', 'Itu', 'Mbo', 'Mkpat Enin', 'Nsit Atai', 'Nsit Ibom', 'Nsit Ubium', 'Obot Akara', 'Okobo', 'Onna', 'Oron', 'Oruk Anam', 'Udung Uko', 'Ukanafun', 'Uquo', 'Uruan', 'Urue Offong Oruko', 'Uyo'],
  'Anambra': ['Aguata', 'Anambra East', 'Anambra West', 'Anaocha', 'Awka North', 'Awka South', 'Ayamelum', 'Dunukofia', 'Ekwusigo', 'Idemili North', 'Idemili South', 'Ihiala', 'Njikoka', 'Nnewi North', 'Nnewi South', 'Ogbaru', 'Onitsha North', 'Onitsha South', 'Orumba North', 'Orumba South', 'Oyi'],
  'Bauchi': ['Alkaleri', 'Bauchi', 'Bogoro', 'Dass', 'Darazo', 'Gamawa', 'Ganjuwa', 'Giade', 'Itas/Gadau', 'Jama\'are', 'Katagum', 'Kirfi', 'Misau', 'Ningi', 'Shira', 'Tafawa Balewa', ' Toro', 'Warji', 'Zaki'],
  'Bayelsa': ['Brass', 'Ekeremor', 'Kolokuma/Opokuma', 'Nembe', 'Ogbia', 'Sagbama', 'Southern Ijaw', 'Yenagoa'],
  'Benue': ['Agatu', 'Apa', 'Ado', 'Buruku', 'Gboko', 'Guma', 'Gwer East', 'Gwer West', 'Katsina-Ala', 'Konshisha', 'Kwande', 'Logo', 'Makurdi', 'Obi', 'Ogbadibo', 'Oju', 'Okpokwu', 'Otukpo', 'Tarka', 'Ukum', 'Ushongo', 'Vandeikya'],
  'Borno': ['Abadam', 'Askira/Uba', 'Bama', 'Bayo', 'Biu', 'Chibok', 'Damboa', 'Dikwa', 'Gubio', 'Guzamala', 'Gwoza', 'Hawul', 'Jere', 'Kaga', 'Kala/Balge', 'Konduga', 'Kukawa', 'Kwaya Kusar', 'Mafa', 'Magumeri', 'Maiduguri', 'Marte', 'Mobbar', 'Monguno', 'Ngala', 'Nganzai', 'Shani'],
  'Cross River': ['Abi', 'Akamkpa', 'Akpabuyo', 'Bakassi', 'Bekwarra', 'Biase', 'Boki', 'Calabar Municipal', 'Calabar South', 'Etung', 'Ikom', 'Obanliku', 'Obudu', 'Odukpani', 'Ogoja', 'Yakuur', 'Yala'],
  'Delta': ['Aniocha North', 'Aniocha South', 'Bomadi', 'Burutu', 'Ethiope East', 'Ethiope West', 'Ika North East', 'Ika South', 'Isoko North', 'Isoko South', 'Ndokwa East', 'Ndokwa West', 'Okpe', 'Oshimili North', 'Oshimili South', 'Patani', 'Sapele', 'Udu', 'Ughelli North', 'Ughelli South', 'Ukwuani', 'Uvwie', 'Warri North', 'Warri South', 'Warri South West'],
  'Ebonyi': ['Abakaliki', 'Afikpo North', 'Afikpo South', 'Ebonyi', 'Ezza North', 'Ezza South', 'Ikwo', 'Ishielu', 'Ivo', 'Izzi', 'Ohaozara', 'Ohaukwu', 'Onicha'],
  'Edo': ['Akoko-Edo', 'Egor', 'Esan Central', 'Esan North-East', 'Esan South-East', 'Esan West', 'Etsako Central', 'Etsako East', 'Etsako West', 'Igueben', 'Ikpoba Okha', 'Oredo', 'Orhionmwon', 'Ovia North-East', 'Ovia South-West', 'Owan East', 'Owan West', 'Uhunmwonde'],
  'Ekiti': ['Ado Ekiti', 'Efon', 'Ekiti East', 'Ekiti South-West', 'Ekiti West', 'Emure', 'Gbonyin', 'Ido Osi', 'Ijero', 'Ikere', 'Ikole', 'Ilejemeje', 'Irepodun/Ifelodun', 'Ise/Orun', 'Iworoko/Ekiti', 'Moba', 'Oye'],
  'Enugu': ['Aninri', 'Awgu', 'Enugu East', 'Enugu North', 'Enugu South', 'Ezeagu', 'Igbo Etiti', 'Igbo Eze North', 'Igbo Eze South', 'Isi Uzo', 'Nkanu East', 'Nkanu West', 'Nsukka', 'Oji River', 'Udenu', 'Udi', 'Uzo Uwani'],
  'FCT': ['Abaji', 'Bwari', 'Gwagwalada', 'Kuje', 'Kwali', 'Municipal Area Council'],
  'Gombe': ['Akko', 'Balanga', 'Billiri', 'Dukku', 'Funakaye', 'Gombe', 'Kaltungo', 'Kwami', 'Nafada', 'Shongom', 'Talewe', 'Yamaltu/Deba'],
  'Imo': ['Aboh Mbaise', 'Ahiazu Mbaise', 'Ehime Mbano', 'Ezinihitte Mbaise', 'Ideato North', 'Ideato South', 'Ihitte/Uboma', 'Ikeduru', 'Isiala Mbano', 'Isu', 'Mbaitoli', 'Ngor Okpala', 'Njaba', 'Nkwerre', 'Nwangele', 'Obowo', 'Oguta', 'Ohaji/Egbema', 'Okigwe', 'Onuimo', 'Orlu', 'Orsu', 'Oru East', 'Oru West', 'Owerri Municipal', 'Owerri North', 'Owerri West', 'Oguta'],
  'Jigawa': ['Auyo', 'Babura', 'Biriniwa', 'Birnin Kudu', 'Buji', 'Dutse', 'Gagarawa', 'Garki', 'Gumel', 'Guri', 'Gwaram', 'Gwiwa', 'Hadejia', 'Jahun', 'Kafin Hausa', 'Kaugama', 'Kazaure', 'Kiri Kasama', 'Kiyawa', 'Maigatari', 'Malam Madori', 'Miga', 'Ringim', 'Roni', 'Sule Tankarkar', 'Taura', 'Yankwashi'],
  'Kaduna': ['Birnin Gwari', 'Chikun', 'Giwa', 'Igabi', 'Ikara', 'Jaba', 'Jemaa', 'Kachia', 'Kaduna North', 'Kaduna South', 'Kagarko', 'Kajuru', 'Kaura', 'Kauru', 'Kubau', 'Kudan', 'Lere', 'Makarfi', 'Sabon Gari', 'Sanga', 'Soba', 'Zangon Kataf', 'Zaria'],
  'Kano': ['Ajingi', 'Albasu', 'Bagwai', 'Bebeji', 'Bichi', 'Bunkure', 'Dala', 'Dambatta', 'Dawakin Kudu', 'Dawakin Tofa', 'Doguwa', 'Fagge', 'Gabasawa', 'Garko', 'Garum Mallam', 'Gaya', 'Gezawa', 'Gwale', 'Gwarzo', 'Kabo', 'Kano Municipal', 'Karaye', 'Kibiya', 'Kiru', 'Kumbotso', 'Kunchi', 'Kura', 'Madobi', 'Makoda', 'Minjibir', 'Nasarawa', 'Rano', 'Rimin Gado', 'Rogo', 'Shanono', 'Sumaila', 'Takai', 'Tarauni', 'Tofa', 'Tsanyawa', 'Tudun Wada', 'Ungogo', 'Warawa', 'Wudil'],
  'Katsina': ['Bakori', 'Batagarawa', 'Batsari', 'Baure', 'Bindawa', 'Charanchi', 'Dandume', 'Danja', 'Dan Musa', 'Daura', 'Dutsin-Ma', 'Faskari', 'Funtua', 'Ingawa', 'Jibia', 'Kafur', 'Kaita', 'Kankara', 'Kankia', 'Kurfi', 'Kusada', 'Mai\'Adua', 'Malumfashi', 'Mani', 'Mashi', 'Matazu', 'Musawa', 'Rimi', 'Sabuwa', 'Safana', 'Sandamu', 'Zango'],
  'Kebbi': ['Aleiro', 'Arewa Dandi', 'Argungu', 'Augie', 'Bagudo', 'Birnin Kebbi', 'Bunza', 'Dandi', 'Fakai', 'Gwandu', 'Jega', 'Kalgo', 'Koko/Besse', 'Maiyama', 'Ngaski', 'Shanga', 'Suru', 'Wasagu/Danko', 'Yauri', 'Zuru'],
  'Kogi': ['Adavi', 'Ajaokuta', 'Ankpa', 'Bassa', 'Dekina', 'Ibaji', 'Idah', 'Igalamela Odolu', 'Ijumu', 'Kabba/Bunu', 'Kogi', 'Lokoja', 'Mopa-Muro', 'Ofu', 'Ogori/Magongo', 'Okehi', 'Okene', 'Olamaboro', 'Omala', 'Yagba East', 'Yagba West'],
  'Kwara': ['Asa', 'Baruten', 'Edu', 'Ekiti', 'Ifelodun', 'Ilorin East', 'Ilorin South', 'Ilorin West', 'Irepodun', 'Isin', 'Kaiama', 'Moro', 'Offa', 'Oke-Ero', 'Oyun', 'Pategi'],
  'Lagos': ['Agege', 'Ajeromi-Ifelodun', 'Alimosho', 'Amuwo-Odofin', 'Apapa', 'Badagry', 'Epe', 'Eti-Osa', 'Ibeju-Lekki', 'Ifako-Ijaiye', 'Ikeja', 'Ikorodu', 'Kosofe', 'Lagos Island', 'Lagos Mainland', 'Mushin', 'Ojo', 'Oshodi-Isolo', 'Shomolu', 'Suru-Lere', 'Yaba'],
  'Nasarawa': ['Akwanga', 'Doma', 'Karu', 'Keana', 'Keffi', 'Kokona', 'Lafia', 'Nasarawa', 'Nasarawa Egon', 'Obi', 'Toto', 'Wamba'],
  'Niger': ['Agaie', 'Agwara', 'Bida', 'Borgu', 'Bosso', 'Chanchaga', 'Edati', 'Gbako', 'Gurara', 'Katcha', 'Kontagora', 'Lapai', 'Lavun', 'Magama', 'Mariga', 'Mashegu', 'Mokwa', 'Munya', 'Paikoro', 'Rafi', 'Rijau', 'Shiroro', 'Suleja', 'Tafa', 'Wushishi'],
  'Ogun': ['Abeokuta North', 'Abeokuta South', 'Ado-Odo/Ota', 'Ewekoro', 'Ifo', 'Ijebu East', 'Ijebu North', 'Ijebu North East', 'Ijebu Ode', 'Ikenne', 'Imeko Afon', 'Ipokia', 'Obafemi Owode', 'Odeda', 'Odogbolu', 'Ogun Waterside', 'Remo North', 'Shagamu', 'Sagamu', 'Iperu', 'Ilaro'],
  'Ondo': ['Akoko North East', 'Akoko North West', 'Akoko South East', 'Akoko South West', 'Akure North', 'Akure South', 'Ese Odo', 'Idanre', 'Ifedore', 'Ilaje', 'Ile Oluji/Okeigbo', 'Irele', 'Odigbo', 'Okitipupa', 'Ondo East', 'Ondo West', 'Ose', 'Owo'],
  'Osun': ['Atakunmosa East', 'Atakunmosa West', 'Aiyedire', 'Boluwaduro', 'Boripe', 'Ede North', 'Ede South', 'Egbedore', 'Ejigbo', 'Ife Central', 'Ife East', 'Ife North', 'Ife South', 'Ifedayo', 'Ifelodun', 'Ila', 'Ilesa East', 'Ilesa West', 'Irepodun', 'Irewole', 'Isokan', 'Iwo', 'Obokun', 'Odo Otin', 'Ola Oluwa', 'Olorunda', 'Oriade', 'Orolu', 'Osogbo'],
  'Oyo': ['Afijio', 'Akinyele', 'Atiba', 'Atisbo', 'Egbeda', 'Ibadan North', 'Ibadan North East', 'Ibadan North West', 'Ibadan South East', 'Ibadan South West', 'Ibarapa Central', 'Ibarapa East', 'Ibarapa North', 'Ido', 'Irepo', 'Iseyin', 'Itesiwaju', 'Iwajowa', 'Kajola', 'Lagelu', 'Ogo Oluwa', 'Ogbomoso North', 'Ogbomoso South', 'Oyo East', 'Oyo West', 'Saki East', 'Saki West', 'Surulere'],
  'Plateau': ['Barkin Ladi', 'Bassa', 'Bokkos', 'Jos East', 'Jos North', 'Jos South', 'Kanam', 'Kanke', 'Langtang North', 'Langtang South', 'Mangu', 'Mikang', 'Pankshin', 'Qua\'an Pan', 'Riyom', 'Shendam', 'Wase'],
  'Rivers': ['Abua/Odual', 'Ahoada East', 'Ahoada West', 'Akuku-Toru', 'Andoni', 'Asari-Toru', 'Bonny', 'Degema', 'Emohua', 'Eleme', 'Etche', 'Gokana', 'Ikwerre', 'Khana', 'Obio/Akpor', 'Ogba/Egbema/Ndoni', 'Ogu/Bolo', 'Okrika', 'Omuma', 'Opobo/Nkoro', 'Oyigbo', 'Port Harcourt', 'Tai'],
  'Sokoto': ['Binji', 'Bodinga', 'Dange Shuni', 'Gada', 'Goronyo', 'Gudu', 'Gwadabawa', 'Illela', 'Isa', 'Kebbe', 'Kware', 'Rabah', 'Sabon Birni', 'Shagari', 'Silame', 'Sokoto North', 'Sokoto South', 'Tambuwal', 'Tangaza', 'Tureta', 'Wamako', 'Wurno', 'Yabo'],
  'Taraba': ['Ardo Kola', 'Bali', 'Donga', 'Gashaka', 'Gassol', 'Ibi', 'Jalingo', 'Karim Lamido', 'Kurmi', 'Lau', 'Sardauna', 'Takum', 'Ussa', 'Wukari', 'Yorro', 'Zing'],
  'Yobe': ['Bade', 'Bursari', 'Damaturu', 'Fika', 'Fune', 'Geidam', 'Gujba', 'Gulani', 'Jakusko', 'Karasuwa', 'Machina', 'Nangere', 'Nguru Potiskum', 'Tarmuwa', 'Yunusari', 'Yusufari'],
  'Zamfara': ['Anka', 'Bakura', 'Birnin Magaji/Kiyaw', 'Bukkuyum', 'Bungudu', 'Gummi', 'Gusau', 'Isah', 'Kaura Namoda', 'Kiyawa', 'Maradun', 'Maru', 'Shinkafi', 'Talata Mafara', 'Tsafe', 'Zurmi'],
};

const PARTIES = [
  { official_name: 'All Progressives Congress', abbreviation: 'APC', color: '#00A859' },
  { official_name: 'Peoples Democratic Party', abbreviation: 'PDP', color: '#0000FF' },
  { official_name: 'Labour Party', abbreviation: 'LP', color: '#00FF00' },
  { official_name: 'New Nigeria Peoples Party', abbreviation: 'NNPP', color: '#FF0000' },
  { official_name: 'All Progressives Grand Alliance', abbreviation: 'APGA', color: '#FFD700' },
  { official_name: 'Social Democratic Party', abbreviation: 'SDP', color: '#800080' },
  { official_name: 'Young Progressives Party', abbreviation: 'YPP', color: '#FF4500' },
  { official_name: 'African Democratic Congress', abbreviation: 'ADC', color: '#008000' },
];

const ELECTIONS = [
  { name: '2027 Presidential Election', type: 'PRESIDENTIAL', scheduled_start: '2027-01-16T08:00:00Z', scheduled_end: '2027-01-16T18:00:00Z' },
  { name: '2027 Senate Election', type: 'SENATE', scheduled_start: '2027-01-16T08:00:00Z', scheduled_end: '2027-01-16T18:00:00Z' },
  { name: '2027 House of Representatives', type: 'HOUSE', scheduled_start: '2027-01-16T08:00:00Z', scheduled_end: '2027-01-16T18:00:00Z' },
  { name: '2027 Governorship Election', type: 'GOVERNORSHIP', scheduled_start: '2027-02-06T08:00:00Z', scheduled_end: '2027-02-06T18:00:00Z' },
  { name: '2027 State Assembly Election', type: 'STATE_ASSEMBLY', scheduled_start: '2027-02-06T08:00:00Z', scheduled_end: '2027-02-06T18:00:00Z' },
];

// Nigerian state codes
const STATE_CODES: Record<string, string> = {
  'Abia': 'AB', 'Adamawa': 'AD', 'Akwa Ibom': 'AK', 'Anambra': 'AN',
  'Bauchi': 'BA', 'Bayelsa': 'BY', 'Benue': 'BE', 'Borno': 'BO',
  'Cross River': 'CR', 'Delta': 'DE', 'Ebonyi': 'EB', 'Edo': 'ED',
  'Ekiti': 'EK', 'Enugu': 'EN', 'FCT': 'FC', 'Gombe': 'GO',
  'Imo': 'IM', 'Jigawa': 'JI', 'Kaduna': 'KD', 'Kano': 'KN',
  'Katsina': 'KT', 'Kebbi': 'KB', 'Kogi': 'KG', 'Kwara': 'KW',
  'Lagos': 'LA', 'Nasarawa': 'NA', 'Niger': 'NI', 'Ogun': 'OG',
  'Ondo': 'ON', 'Osun': 'OS', 'Oyo': 'OY', 'Plateau': 'PL',
  'Rivers': 'RV', 'Sokoto': 'SO', 'Taraba': 'TA', 'Yobe': 'YO',
  'Zamfara': 'ZF',
};

// Approximate coordinates for each state capital (for map display)
const STATE_COORDS: Record<string, [number, number]> = {
  'Abia': [5.1, 7.38], 'Adamawa': [9.33, 12.39], 'Akwa Ibom': [5.03, 7.91],
  'Anambra': [6.21, 6.99], 'Bauchi': [10.31, 9.84], 'Bayelsa': [4.77, 6.36],
  'Benue': [7.32, 8.73], 'Borno': [11.83, 13.16], 'Cross River': [5.96, 8.33],
  'Delta': [5.52, 5.75], 'Ebonyi': [6.32, 8.09], 'Edo': [6.34, 5.60],
  'Ekiti': [7.62, 5.22], 'Enugu': [6.44, 7.50], 'FCT': [9.06, 7.49],
  'Gombe': [10.29, 11.17], 'Imo': [5.48, 7.03], 'Jigawa': [12.22, 9.35],
  'Kaduna': [10.52, 7.43], 'Kano': [12.00, 8.52], 'Katsina': [12.99, 7.60],
  'Kebbi': [12.45, 4.20], 'Kogi': [7.80, 6.74], 'Kwara': [8.50, 4.55],
  'Lagos': [6.52, 3.38], 'Nasarawa': [8.54, 8.30], 'Niger': [9.61, 6.55],
  'Ogun': [7.16, 3.35], 'Ondo': [7.25, 5.19], 'Osun': [7.77, 4.56],
  'Oyo': [7.97, 3.93], 'Plateau': [9.91, 8.90], 'Rivers': [4.81, 7.04],
  'Sokoto': [13.06, 5.24], 'Taraba': [7.87, 10.78], 'Yobe': [11.75, 11.97],
  'Zamfara': [12.17, 6.66],
};

// Approximate coordinates for LGAs (simplified)
const getLGACoords = (stateName: string, lgaName: string, index: number): [number, number] => {
  const stateCoords = STATE_COORDS[stateName] || [9.0, 7.5];
  // Spread LGAs around the state capital
  const angle = (index * 360) / 20;
  const radius = 0.5 + Math.random() * 0.5;
  const lat = stateCoords[0] + radius * Math.cos(angle * Math.PI / 180);
  const lng = stateCoords[1] + radius * Math.sin(angle * Math.PI / 180);
  return [lat, lng];
};

// Approximate coordinates for wards (simplified)
const getWardCoords = (lgaLat: number, lgaLng: number, index: number): [number, number] => {
  const angle = (index * 360) / 15;
  const radius = 0.1 + Math.random() * 0.2;
  const lat = lgaLat + radius * Math.cos(angle * Math.PI / 180);
  const lng = lgaLng + radius * Math.sin(angle * Math.PI / 180);
  return [lat, lng];
};

// Approximate coordinates for polling units (simplified)
const getPUCoords = (wardLat: number, wardLng: number, index: number): [number, number] => {
  const angle = (index * 360) / 10;
  const radius = 0.01 + Math.random() * 0.05;
  const lat = wardLat + radius * Math.cos(angle * Math.PI / 180);
  const lng = wardLng + radius * Math.sin(angle * Math.PI / 180);
  return [lat, lng];
};

// Generate polling units for a ward
const generatePollingUnits = (
  wardCode: string,
  wardName: string,
  wardLat: number,
  wardLng: number,
  count: number
): Array<{ official_code: string; name: string; latitude: number; longitude: number; registered_voters: number }> => {
  const units = [];
  const unitTypes = ['Primary School', 'Secondary School', 'Town Hall', 'Community Center', 'Church', 'Mosque', 'Health Center', 'Market Square', 'Village Square', 'Palace'];
  
  for (let i = 1; i <= count; i++) {
    const code = `${wardCode}/${String(i).padStart(3, '0')}`;
    const [lat, lng] = getPUCoords(wardLat, wardLng, i);
    const unitType = unitTypes[Math.floor(Math.random() * unitTypes.length)];
    const name = `${unitType} ${String(i).padStart(3, '0')}`;
    
    units.push({
      official_code: code,
      name,
      latitude: parseFloat(lat.toFixed(6)),
      longitude: parseFloat(lng.toFixed(6)),
      registered_voters: Math.floor(500 + Math.random() * 1000),
    });
  }
  
  return units;
};

async function setup() {
  console.log('=== NIGERIA ELECTION OBSERVATION PLATFORM - FULL SETUP ===\n');
  
  // Step 1: Create States
  console.log('Step 1: Creating states...');
  const stateIdMap: Record<string, string> = {};
  
  for (const [stateName, lgas] of Object.entries(STATES_LGAS)) {
    const code = STATE_CODES[stateName];
    const { data, error } = await supabase
      .from('states')
      .upsert({ name: stateName, code }, { onConflict: 'code' })
      .select('id, code')
      .single();
    
    if (error) {
      console.error(`  Error creating state ${stateName}:`, error.message);
    } else if (data) {
      stateIdMap[stateName] = data.id;
      console.log(`  ✓ ${stateName} (${code})`);
    }
  }
  
  // Step 2: Create LGAs
  console.log('\nStep 2: Creating LGAs...');
  const lgaIdMap: Record<string, string> = {};
  let totalLGAs = 0;
  
  for (const [stateName, lgas] of Object.entries(STATES_LGAS)) {
    const stateId = stateIdMap[stateName];
    if (!stateId) continue;
    
    for (let i = 0; i < lgas.length; i++) {
      const lgaName = lgas[i].trim();
      const lgaCode = `${String(i + 1).padStart(2, '0')}`;
      
      const { data, error } = await supabase
        .from('lgas')
        .upsert({ state_id: stateId, name: lgaName, code: lgaCode }, { onConflict: 'state_id,code' })
        .select('id')
        .single();
      
      if (error) {
        console.error(`  Error creating LGA ${lgaName}:`, error.message);
      } else if (data) {
        lgaIdMap[`${stateName}:${lgaName}`] = data.id;
        totalLGAs++;
      }
    }
  }
  console.log(`  ✓ Created ${totalLGAs} LGAs`);
  
  // Step 3: Create Wards (5 per LGA for demo)
  console.log('\nStep 3: Creating wards...');
  const wardIdMap: Record<string, string> = {};
  let totalWards = 0;
  
  for (const [stateName, lgas] of Object.entries(STATES_LGAS)) {
    const stateId = stateIdMap[stateName];
    if (!stateId) continue;
    
    for (let i = 0; i < lgas.length; i++) {
      const lgaName = lgas[i].trim();
      const lgaId = lgaIdMap[`${stateName}:${lgaName}`];
      if (!lgaId) continue;
      
      const [lgaLat, lgaLng] = getLGACoords(stateName, lgaName, i);
      
      for (let j = 1; j <= 5; j++) {
        const wardCode = `${String(i + 1).padStart(2, '0')}${String(j).padStart(2, '0')}`;
        const wardName = `Ward ${j}`;
        const [wardLat, wardLng] = getWardCoords(lgaLat, lgaLng, j);
        
        const { data, error } = await supabase
          .from('wards')
          .upsert({ lga_id: lgaId, name: wardName, code: wardCode }, { onConflict: 'lga_id,code' })
          .select('id')
          .single();
        
        if (error) {
          // Skip duplicate errors
        } else if (data) {
          wardIdMap[`${stateName}:${lgaName}:${wardCode}`] = data.id;
          totalWards++;
        }
      }
    }
  }
  console.log(`  ✓ Created ${totalWards} wards`);
  
  // Step 4: Create Polling Units (3 per ward)
  console.log('\nStep 4: Creating polling units...');
  let totalPUs = 0;
  
  for (const [stateName, lgas] of Object.entries(STATES_LGAS)) {
    const stateId = stateIdMap[stateName];
    if (!stateId) continue;
    
    for (let i = 0; i < lgas.length; i++) {
      const lgaName = lgas[i].trim();
      const lgaId = lgaIdMap[`${stateName}:${lgaName}`];
      if (!lgaId) continue;
      
      const [lgaLat, lgaLng] = getLGACoords(stateName, lgaName, i);
      
      for (let j = 1; j <= 5; j++) {
        const wardCode = `${String(i + 1).padStart(2, '0')}${String(j).padStart(2, '0')}`;
        const wardId = wardIdMap[`${stateName}:${lgaName}:${wardCode}`];
        if (!wardId) continue;
        
        const [wardLat, wardLng] = getWardCoords(lgaLat, lgaLng, j);
        const pollingUnits = generatePollingUnits(wardCode, `Ward ${j}`, wardLat, wardLng, 3);
        
        for (const pu of pollingUnits) {
          const { error } = await supabase
            .from('polling_units')
            .upsert({
              official_code: pu.official_code,
              name: pu.name,
              state_id: stateId,
              lga_id: lgaId,
              ward_id: wardId,
              latitude: pu.latitude,
              longitude: pu.longitude,
              registered_voters: pu.registered_voters,
            }, { onConflict: 'official_code' });
          
          if (!error) totalPUs++;
        }
      }
    }
  }
  console.log(`  ✓ Created ${totalPUs} polling units`);
  
  // Step 5: Create Parties
  console.log('\nStep 5: Creating parties...');
  for (const party of PARTIES) {
    const { error } = await supabase
      .from('parties')
      .upsert(party, { onConflict: 'official_name' });
    
    if (!error) console.log(`  ✓ ${party.abbreviation}`);
  }
  
  // Step 6: Create Elections
  console.log('\nStep 6: Creating elections...');
  for (const election of ELECTIONS) {
    const { error } = await supabase
      .from('elections')
      .upsert({ ...election, status: 'PLANNED' }, { onConflict: 'name' });
    
    if (!error) console.log(`  ✓ ${election.name}`);
  }
  
  console.log('\n=== SETUP COMPLETE ===');
  console.log(`States: ${Object.keys(stateIdMap).length}`);
  console.log(`LGAs: ${totalLGAs}`);
  console.log(`Wards: ${totalWards}`);
  console.log(`Polling Units: ${totalPUs}`);
  console.log(`Parties: ${PARTIES.length}`);
  console.log(`Elections: ${ELECTIONS.length}`);
}

setup().catch(console.error);
