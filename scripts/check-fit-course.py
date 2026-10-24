"""Inspect an exported Course with fitdecode, independent from the JS encoder.

Install in a Python virtual environment: pip install fitdecode==0.11.0
Run: python scripts/check-fit-course.py /path/to/course.fit
This verifies the file, not the behavior of a Garmin device.
"""
import argparse
import json

import fitdecode


def inspect_course(path):
    messages = {}
    with fitdecode.FitReader(path, check_crc=fitdecode.CrcCheck.RAISE,
                             error_handling=fitdecode.ErrorHandling.RAISE) as reader:
        for frame in reader:
            if isinstance(frame, fitdecode.FitDataMessage):
                messages.setdefault(frame.name, []).append({field.name: field.value for field in frame.fields})

    assert len(messages.get('file_id', [])) == 1, 'Expected one file_id'
    assert messages['file_id'][0]['type'] == 'course', 'Expected a Course file'
    assert len(messages.get('course', [])) == 1, 'Expected one course'
    assert not messages.get('activity') and not messages.get('session'), 'Unexpected recorded activity'
    records = messages.get('record', [])
    points = messages.get('course_point', [])
    assert len(records) >= 2, 'Missing course geometry'
    assert records[0]['distance'] == 0, 'Course distance must start at zero'
    distance = records[-1]['distance']
    assert distance > 0, 'Empty course'
    assert len(messages.get('lap', [])) == 1, 'Expected one summary lap'
    assert abs(messages['lap'][0]['total_distance'] - distance) <= .01, 'Inconsistent summary distance'
    for previous, current in zip(records, records[1:]):
        assert current['distance'] >= previous['distance'], 'Records run backwards'
        assert current['timestamp'] >= previous['timestamp'], 'Record times run backwards'
    for record in [*records, *points]:
        assert record.get('position_lat') is not None and record.get('position_long') is not None, 'Invalid position'
    assert points[0]['name'] == 'START COURSE' and points[-1]['name'] == 'FINISH COURSE', 'Missing course boundaries'
    assert all(0 <= point['distance'] <= distance for point in points), 'Course point outside course'
    assert all(a['distance'] <= b['distance'] for a, b in zip(points, points[1:])), 'Course points run backwards'
    events = messages.get('event', [])
    assert events[0]['event'] == 'timer' and events[0]['event_type'] == 'start', 'Missing timer start'
    assert events[-1]['event'] == 'timer' and events[-1]['event_type'] == 'stop_all', 'Missing timer stop'
    return {
        'reader': 'fitdecode 0.11.0', 'crc': 'valid', 'type': 'course',
        'sport': messages['course'][0]['sport'], 'distanceM': distance,
        'records': len(records), 'durationS': messages['lap'][0]['total_timer_time'],
        'unknownAltitudes': sum(record.get('altitude') is None for record in records),
        'points': [{key: point[key] for key in ['name', 'distance', 'type', 'position_lat', 'position_long']} for point in points],
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('file')
    arguments = parser.parse_args()
    print(json.dumps(inspect_course(arguments.file), ensure_ascii=False, indent=2))
