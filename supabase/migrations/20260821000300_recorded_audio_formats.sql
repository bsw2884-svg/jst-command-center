-- Allow browser-native microphone recordings alongside existing uploaded audio.
update storage.buckets
set allowed_mime_types = array[
  'audio/mpeg','audio/mp3','audio/wav','audio/x-wav',
  'audio/mp4','audio/x-m4a','audio/aac','audio/x-aac',
  'audio/webm','audio/ogg'
]
where id = 'song-audio';
