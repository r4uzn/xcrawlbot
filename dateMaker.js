const dateMaker = (timestamp) => {
    var date = new Date(Date.parse(timestamp));
    var years = date.getFullYear();
    var months = date.getMonth() + 1;
    var days = date.getDate();
    var hours = date.getHours();
    var minutes = date.getMinutes();
	var seconds = date.getSeconds();
  
    return `${ years }년 ${ months }월 ${ days }일 ${ hours }시 ${ minutes }분 ${ seconds }초`;
  };

export default dateMaker;
