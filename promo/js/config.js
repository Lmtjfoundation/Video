// Edit these values to point the ad at your channel.
// Any value can also be overridden from the page URL, e.g.
//   promo/?sub=https://youtube.com/@yourchannel&handle=@yourchannel
const params = new URLSearchParams(location.search);

export const CONFIG = {
  // Where the "Subscribe" buttons send people.
  // TODO: replace with the real channel link (YouTube: add ?sub_confirmation=1
  // to open the subscribe prompt straight away).
  subscribeUrl: params.get('sub') || 'https://www.youtube.com/@YOUR_CHANNEL?sub_confirmation=1',
  // Shown on the trailer end card and next to the buttons.
  handle: params.get('handle') || '',
  // Link to the playable game.
  playUrl: params.get('play') || '../game/',
};

export const isPlaceholderLink = () => CONFIG.subscribeUrl.includes('YOUR_CHANNEL');
