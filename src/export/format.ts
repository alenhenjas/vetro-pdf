/**
 * Formato di salvataggio.
 *
 * Catalog /VetroPDF → dizionario di progetto:
 *   /Version  /DocId
 *   /Data     stream Flate con il JSON delle annotazioni (ProjectData, pagine = slot)
 *   /Images   << /assetId rif. all'Image XObject >> (le immagini sono memorizzate una volta sola)
 *   /Pages    [ << /Page rif /Layer rif /HasRes /OrigRes /HasMedia /OrigMedia /HasCrop /OrigCrop >> ... ]
 *   /Wrap     [ rif a "q"  rif a "Q" ]
 *   /Objects  [ tutti gli oggetti creati da Vetro PDF ]
 *
 * Ogni pagina annotata ha /Contents = [q, ...originali, Q, layer]; il layer invoca il
 * Form XObject /VetroLayer, disegno vettoriale visibile da qualunque lettore.
 *
 * All'apertura lo strato viene tolto (`parseProject`) e l'app lavora sul PDF pulito;
 * ogni salvataggio riparte da lì, quindi nulla può accumularsi o duplicarsi.
 */
export const CATALOG_KEY = 'VetroPDF';
export const LAYER_NAME = 'VetroLayer';
export const FORMAT_VERSION = 1;
