"""Fictional audiovisual frames; never a tenant schema."""
import json, subprocess
from pathlib import Path
import pytest
from panopto_archiver.learning_media import prepare, local


def test_reference_path_confinement_and_missing_media(tmp_path):
    (tmp_path/'metadata').mkdir()
    (tmp_path/'metadata/resources.json').write_text(json.dumps({'resources':[]}))
    result=prepare({'folder':str(tmp_path),'anchors':[]})
    assert not result['feeds'] and not result['frames']
    assert 'No supported local video' in ' '.join(result['warnings'])
    with pytest.raises(ValueError): local(tmp_path,'../escape')


def test_real_reference_frames_and_probe(tmp_path, av_tools):
    ffmpeg, ffprobe = av_tools
    if not ffmpeg or not ffprobe: pytest.skip('Configured audiovisual test binaries required')
    (tmp_path/'metadata').mkdir();(tmp_path/'media').mkdir()
    video=tmp_path/'media/fictional.mp4'
    subprocess.run([ffmpeg,'-v','error','-f','lavfi','-i','color=c=red:s=160x90:r=10','-f','lavfi','-i','sine=frequency=440','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',str(video)],check=True)
    (tmp_path/'metadata/resources.json').write_text(json.dumps({'resources':[{'outcome':'success','files':['media/fictional.mp4']}]}))
    result=prepare({'folder':str(tmp_path),'anchors':[.5,1],'ffmpeg':ffmpeg,'ffprobe':ffprobe})
    assert result['feeds'][0]['hasAudio'] is True
    assert result['feeds'][0]['role']=='unclassified'
    assert result['frames']
    image=tmp_path/'learning'/result['frames'][0]['path']
    assert image.read_bytes()[:2]==b'\xff\xd8'
    decoded=subprocess.run([ffmpeg,'-v','error','-i',str(image),'-f','null','-'],capture_output=True)
    assert decoded.returncode==0
    repeated=prepare({'folder':str(tmp_path),'anchors':[.5,1],'ffmpeg':ffmpeg,'ffprobe':ffprobe})
    assert repeated['frames']==result['frames']
